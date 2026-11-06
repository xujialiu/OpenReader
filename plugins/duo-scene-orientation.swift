// App-owned extension of Expo's generated scene, not a second scene lifecycle.
class SceneDelegate: ExpoAppSceneDelegate {
#if canImport(UIKit, _version: 9127.0.85)
  // A nullable hinge update is not a hardware classification. Keep positive
  // evidence for this scene session even during a transient hierarchy change.
  private var hingeSession: String?
  private weak var observedWindow: UIWindow?
  private var hingeObservation: (any UIInteraction)?

  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)
    if #available(iOS 27.1, *), let windowScene = scene as? UIWindowScene {
      observeHinge(in: windowScene)
    }
  }

  override func sceneDidBecomeActive(_ scene: UIScene) {
    super.sceneDidBecomeActive(scene)
    if #available(iOS 27.1, *), let windowScene = scene as? UIWindowScene {
      observeHinge(in: windowScene)
      if hingeSession == windowScene.session.persistentIdentifier {
        refreshOrientations(in: windowScene)
      }
    }
  }

  override func sceneDidDisconnect(_ scene: UIScene) {
    if let observation = hingeObservation { observedWindow?.removeInteraction(observation) }
    hingeObservation = nil
    observedWindow = nil
    // A reconnect of the same scene retains positive evidence; another scene
    // cannot use it because the supported-mask query compares session ids.
    super.sceneDidDisconnect(scene)
  }

  @available(iOS 27.1, *)
  private func observeHinge(in scene: UIWindowScene) {
    guard scene.traitCollection.userInterfaceIdiom == .phone,
      let window = window, window.windowScene === scene,
      observedWindow !== window else { return }
    if let observation = hingeObservation { observedWindow?.removeInteraction(observation) }
    observedWindow = window
    let observation = UIHingeInteraction { [weak self, weak scene] _, update in
      guard let self, let scene, update.hinge != nil,
        self.hingeSession != scene.session.persistentIdentifier else { return }
      self.hingeSession = scene.session.persistentIdentifier
#if DEBUG
      NSLog("[OpenReader orientation] positive hinge evidence for the phone scene")
#endif
      self.refreshOrientations(in: scene)
    }
    hingeObservation = observation
    window.addInteraction(observation)
  }

  @available(iOS 27.0, *)
  func supportedInterfaceOrientations(for windowScene: UIWindowScene) -> UIInterfaceOrientationMask {
    let fallback = configuredOrientations(for: windowScene)
    guard windowScene.traitCollection.userInterfaceIdiom == .phone,
      hingeSession == windowScene.session.persistentIdentifier else { return fallback }
    // Preserve the configured portrait choices. The system decides which of
    // the offered orientations can actually be used on this display/window.
    return fallback.union(.landscape)
  }

  @available(iOS 27.1, *)
  private func refreshOrientations(in scene: UIWindowScene) {
    window?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    guard scene.activationState == .foregroundActive else { return }
    scene.requestGeometryUpdate(.iOS(interfaceOrientations: supportedInterfaceOrientations(for: scene))) { error in
#if DEBUG
      let failure = error as NSError
      NSLog("[OpenReader orientation] system declined geometry request: %@ %ld", failure.domain, failure.code)
#endif
    }
  }

  private func configuredOrientations(for scene: UIWindowScene) -> UIInterfaceOrientationMask {
    let tablet = scene.traitCollection.userInterfaceIdiom == .pad || scene.traitCollection.userInterfaceIdiom == .mac
    let info = Bundle.main.infoDictionary ?? [:]
    let names = (tablet ? info["UISupportedInterfaceOrientations~ipad"] as? [String] : nil)
      ?? info["UISupportedInterfaceOrientations"] as? [String] ?? []
    var mask: UIInterfaceOrientationMask = []
    for name in names {
      switch name {
      case "UIInterfaceOrientationPortrait": mask.insert(.portrait)
      case "UIInterfaceOrientationPortraitUpsideDown": mask.insert(.portraitUpsideDown)
      case "UIInterfaceOrientationLandscapeLeft": mask.insert(.landscapeLeft)
      case "UIInterfaceOrientationLandscapeRight": mask.insert(.landscapeRight)
      default: break
      }
    }
    return mask.isEmpty ? (tablet ? .all : .allButUpsideDown) : mask
  }
#endif
}
