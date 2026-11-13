import Foundation
import UIKit
import AVFoundation
import MediaPlayer
import Capacitor

/// Ovládání pohádky mimo aplikaci na iPhonu: Právě hraje na zamčené obrazovce a v Ovládacím centru
/// (obálka, název, tlačítka předchozí / přehrát-pozastavit / další), tlačítka na sluchátkách a CarPlay.
/// Stejné rozhraní jako Android (PrehravacPlugin.java), v JS `Capacitor.Plugins.Prehravac` (app/media.js):
///  update({ title, subtitle, artwork?, playing, hasPrev, hasNext }) – artwork jako data URL, jen když se změní
///  stop() – pohádka zavřená, Právě hraje zmizí
/// Stisknutá tlačítka přicházejí jako událost „action“ { action: play|pause|toggle|next|prev|stop }.
///
/// Zvuk hraje WebView (Web Audio). Právě hraje z navigator.mediaSession WebKit pro Web Audio vyplní jen název,
/// bez obálky a bez tlačítek, proto ho media.js na iPhonu nepoužívá a vše dělá tento doplněk.
/// Hovor, budík nebo Siri zvuk přeruší: pohádka se pozastaví a po skončení přerušení pokračuje sama.
/// Vytažená sluchátka pohádku pozastaví (jinak by začala hrát nahlas z reproduktoru).
@objc(PrehravacPlugin)
public class PrehravacPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrehravacPlugin"
    public let jsName = "Prehravac"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private var info: [String: Any] = [:]
    private var playing = false
    private var active = false
    /// pohádka hrála, když přišlo přerušení (hovor) – po jeho konci se má rozehrát
    private var resumeAfterInterruption = false
    private var targets: [(MPRemoteCommand, Any)] = []

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: nil)
        nc.addObserver(self, selector: #selector(mediaReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private var wakeTask: UIBackgroundTaskIdentifier = .invalid

    private func emit(_ action: String) {
        // Pozastavenou pohádku iOS po chvíli uspí i s WebView. Tlačítko Přehrát (zamčená obrazovka,
        // sluchátka, konec hovoru) aplikaci probudí jen nakrátko: krátká úloha na pozadí jí dá čas,
        // aby JS stihl rozjet zvuk (pak už aplikaci drží naživu přehrávání, UIBackgroundModes audio).
        if action != "pause" && action != "stop" {
            if wakeTask != .invalid { UIApplication.shared.endBackgroundTask(wakeTask) }
            wakeTask = UIApplication.shared.beginBackgroundTask(withName: "Ospalek přehrát") { [weak self] in
                guard let self = self else { return }
                UIApplication.shared.endBackgroundTask(self.wakeTask)
                self.wakeTask = .invalid
            }
            let task = wakeTask
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
                guard let self = self, self.wakeTask == task, task != .invalid else { return }
                UIApplication.shared.endBackgroundTask(task)
                self.wakeTask = .invalid
            }
        }
        notifyListeners("action", data: ["action": action], retainUntilConsumed: true)
    }

    // MARK: - update

    @objc func update(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let subtitle = call.getString("subtitle") ?? ""
        let isPlaying = call.getBool("playing") ?? false
        let hasPrev = call.getBool("hasPrev") ?? false
        let hasNext = call.getBool("hasNext") ?? false
        // data URL se dekóduje mimo hlavní vlákno, velká obálka by jinak zadrhla rozhraní
        let art = call.getString("artwork")
        DispatchQueue.global(qos: .userInitiated).async {
            let image = art.flatMap(PrehravacPlugin.decode)
            DispatchQueue.main.async {
                self.apply(title: title, subtitle: subtitle, playing: isPlaying, hasPrev: hasPrev, hasNext: hasNext, image: image, newArt: art != nil)
                call.resolve()
            }
        }
    }

    private func apply(title: String, subtitle: String, playing isPlaying: Bool, hasPrev: Bool, hasNext: Bool, image: UIImage?, newArt: Bool) {
        if !active {
            active = true
            // kategorie playback: hraje se zamčenou obrazovkou i s přepínačem ticha
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .spokenAudio)
            try? session.setActive(true)
            UIApplication.shared.beginReceivingRemoteControlEvents()
            registerCommands()
        }
        playing = isPlaying
        if isPlaying { resumeAfterInterruption = false }
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = subtitle
        info[MPMediaItemPropertyAlbumTitle] = "Ospalek"
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = 1.0
        if newArt {
            if let image = image {
                info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            } else {
                info.removeValue(forKey: MPMediaItemPropertyArtwork)
            }
        }
        let center = MPRemoteCommandCenter.shared()
        center.previousTrackCommand.isEnabled = hasPrev
        center.nextTrackCommand.isEnabled = hasNext
        let npc = MPNowPlayingInfoCenter.default()
        npc.nowPlayingInfo = info
        npc.playbackState = isPlaying ? .playing : .paused
    }

    // MARK: - stop

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.active {
                self.active = false
                self.playing = false
                self.resumeAfterInterruption = false
                self.info = [:]
                self.unregisterCommands()
                let npc = MPNowPlayingInfoCenter.default()
                npc.nowPlayingInfo = nil
                npc.playbackState = .stopped
                UIApplication.shared.endReceivingRemoteControlEvents()
            }
            call.resolve()
        }
    }

    // MARK: - tlačítka

    private func registerCommands() {
        let c = MPRemoteCommandCenter.shared()
        let add: (MPRemoteCommand, String) -> Void = { cmd, action in
            cmd.isEnabled = true
            let t = cmd.addTarget { [weak self] _ in
                self?.emit(action)
                return .success
            }
            self.targets.append((cmd, t))
        }
        add(c.playCommand, "play")
        add(c.pauseCommand, "pause")
        add(c.togglePlayPauseCommand, "toggle")
        add(c.nextTrackCommand, "next")
        add(c.previousTrackCommand, "prev")
        add(c.stopCommand, "stop")
        // posouvání v čase pohádka nemá (skládá se z vět)
        [c.changePlaybackPositionCommand, c.skipForwardCommand, c.skipBackwardCommand,
         c.seekForwardCommand, c.seekBackwardCommand].forEach { $0.isEnabled = false }
    }

    private func unregisterCommands() {
        targets.forEach { cmd, t in cmd.removeTarget(t) }
        targets.removeAll()
    }

    // MARK: - přerušení a sluchátka

    @objc private func interrupted(_ n: Notification) {
        guard active,
              let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async {
            switch type {
            case .began:
                // hovor, budík, Siri: WebKit zvuk sám ztlumí, aplikace se musí pozastavit, aby nehrála „naprázdno“
                if self.playing {
                    self.resumeAfterInterruption = true
                    self.emit("pause")
                }
            case .ended:
                let opts = (n.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt).map(AVAudioSession.InterruptionOptions.init) ?? []
                if self.resumeAfterInterruption && opts.contains(.shouldResume) {
                    self.resumeAfterInterruption = false
                    try? AVAudioSession.sharedInstance().setActive(true)
                    self.emit("play")
                }
            @unknown default:
                break
            }
        }
    }

    @objc private func routeChanged(_ n: Notification) {
        guard let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        DispatchQueue.main.async {
            if self.active && self.playing { self.emit("pause") }
        }
    }

    @objc private func mediaReset(_ n: Notification) {
        // systém zvuku se restartoval: znovu nastavit relaci, jinak by pohádka po zamčení ztichla
        DispatchQueue.main.async {
            guard self.active else { return }
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try? AVAudioSession.sharedInstance().setActive(true)
            MPNowPlayingInfoCenter.default().nowPlayingInfo = self.info
        }
    }

    // MARK: - obálka

    static let artworkMax: CGFloat = 600

    /// data URL → zmenšený obrázek (zamčená obrazovka větší nepotřebuje, šetří paměť)
    static func decode(_ dataUrl: String) -> UIImage? {
        guard let comma = dataUrl.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...]), options: .ignoreUnknownCharacters),
              let img = UIImage(data: data) else { return nil }
        let scale = min(1, artworkMax / max(img.size.width, img.size.height))
        if scale >= 1 { return img }
        let size = CGSize(width: (img.size.width * scale).rounded(), height: (img.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
