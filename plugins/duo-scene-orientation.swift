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
        self.observedWindow?.windowScene === scene,
        self.window === self.observedWindow,
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
    duoInterfaceOrientations(for: windowScene) ?? configuredOrientations()
  }

  // Positive evidence belongs to this phone scene, not to API availability.
  func duoInterfaceOrientations(for windowScene: UIWindowScene) -> UIInterfaceOrientationMask? {
    let fallback = configuredOrientations()
    guard windowScene.traitCollection.userInterfaceIdiom == .phone,
      hingeSession == windowScene.session.persistentIdentifier else { return nil }
    return fallback.union(.landscape)
  }

  @available(iOS 27.1, *)
  private func refreshOrientations(in scene: UIWindowScene) {
    guard duoInterfaceOrientations(for: scene) != nil,
      let window, window.windowScene === scene,
      let content = window.rootViewController else { return }
    // UIKit also queries the root controller, whose default still reports the
    // portrait plist mask. Keep Expo's existing controller/React view intact
    // as a child; only the confirmed Duo gets this native policy container.
    if !(content is DuoOrientationContainer) {
      window.rootViewController = DuoOrientationContainer(content: content) { [weak self, weak scene, weak content] in
        guard let self, let scene else { return content?.supportedInterfaceOrientations ?? .portrait }
        return self.supportedInterfaceOrientations(for: scene)
      }
    }
    window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    guard scene.activationState == .foregroundActive else { return }
    scene.requestGeometryUpdate(.iOS(interfaceOrientations: supportedInterfaceOrientations(for: scene))) { error in
#if DEBUG
      let failure = error as NSError
      NSLog("[OpenReader orientation] system declined geometry request: %@ %ld", failure.domain, failure.code)
#endif
    }
  }

  private func configuredOrientations() -> UIInterfaceOrientationMask {
    // Match Expo's existing device-idiom fallback, including the iPad-key
    // fallback to the base key. Do not invent a separate Mac policy.
    let tablet = UIDevice.current.userInterfaceIdiom == .pad
    let info = Bundle.main.infoDictionary ?? [:]
    func parsed(_ key: String) -> UIInterfaceOrientationMask {
      var mask: UIInterfaceOrientationMask = []
      for name in info[key] as? [String] ?? [] {
        switch name {
        case "UIInterfaceOrientationPortrait": mask.insert(.portrait)
        case "UIInterfaceOrientationPortraitUpsideDown": mask.insert(.portraitUpsideDown)
        case "UIInterfaceOrientationLandscapeLeft": mask.insert(.landscapeLeft)
        case "UIInterfaceOrientationLandscapeRight": mask.insert(.landscapeRight)
        default: break
        }
      }
      return mask
    }
    if tablet {
      let ipad = parsed("UISupportedInterfaceOrientations~ipad")
      if !ipad.isEmpty { return ipad }
    }
    let base = parsed("UISupportedInterfaceOrientations")
    return base.isEmpty ? (tablet ? .all : .allButUpsideDown) : base
  }
#endif
}

#if canImport(UIKit, _version: 9127.0.85)
@available(iOS 27.1, *)
private final class DuoOrientationContainer: UIViewController {
  private let content: UIViewController
  private let orientations: @MainActor () -> UIInterfaceOrientationMask

  init(content: UIViewController, orientations: @escaping @MainActor () -> UIInterfaceOrientationMask) {
    self.content = content
    self.orientations = orientations
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { return nil }

  override func viewDidLoad() {
    super.viewDidLoad()
    addChild(content)
    let hosted = content.view!
    hosted.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(hosted)
    NSLayoutConstraint.activate([
      hosted.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      hosted.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      hosted.topAnchor.constraint(equalTo: view.topAnchor),
      hosted.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    content.didMove(toParent: self)
  }

  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { orientations() }
  override var prefersInterfaceOrientationLocked: Bool { false }
  override var childForStatusBarStyle: UIViewController? { content }
  override var childForStatusBarHidden: UIViewController? { content }
  override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { content.preferredStatusBarUpdateAnimation }
  override var childForHomeIndicatorAutoHidden: UIViewController? { content }
  override var childForScreenEdgesDeferringSystemGestures: UIViewController? { content }
}
#endif
