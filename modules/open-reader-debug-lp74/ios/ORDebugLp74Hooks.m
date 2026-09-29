// DEBUG-lp74: temporary diagnostics for issue #74. Remove with the fix.
//
// On the owner's iPhone a long press on the reader's text sometimes starts no
// text selection: WebKit's drag attempt fails as usual ("missing staged drag
// source"), and then nothing follows, where a working press goes on to make
// WKContentView first responder and select the word. The logs do not say
// which condition declined. These hooks record, to os_log at the default level
// (persisted on the phone), what UIKit and WebKit decided at each step:
//
// - at every touch-down: the first responder, every WKWebView in the window,
//   the touched WKContentView's interactions and gesture recognizers, every
//   recognizer in the window not at rest, and the scroll views above the touch;
// - while a touch is down: gesture recognizer transitions, WKContentView's
//   answers to the questions that gate text selection, and a snapshot of the
//   touch's recognizers 1.2 s in (after the drag attempt) and at the lift.
//
// Everything is read-only: no hook changes a return value.

#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <os/log.h>

@interface ORDebugLp74Hooks : NSObject
+ (void)install;
@end

static os_log_t lpLog(void) {
  static os_log_t log;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ log = os_log_create("top.xujialiu.openreader.lp74", "diag"); });
  return log;
}

/** os_log truncates long messages, so a long line goes out in numbered parts. */
static void lp(NSString *line) {
  const NSUInteger chunk = 800;
  if (line.length <= chunk) {
    os_log(lpLog(), "[DEBUG-lp74] %{public}@", line);
    return;
  }
  NSUInteger part = 0;
  for (NSUInteger i = 0; i < line.length; i += chunk, part++) {
    NSString *piece = [line substringWithRange:NSMakeRange(i, MIN(chunk, line.length - i))];
    os_log(lpLog(), "[DEBUG-lp74] (%lu) %{public}@", (unsigned long)part, piece);
  }
}

#pragma mark - The touch window

static BOOL lpDown = NO;
static CFTimeInterval lpDownAt = 0;
static CFTimeInterval lpActiveUntil = 0;
static unsigned long lpSeq = 0;
static UITouch *lpTouch = nil;

/** From touch-down until a second after the lift: the only time the chatty hooks log. */
static BOOL lpActive(void) { return lpDown || CACurrentMediaTime() < lpActiveUntil; }
static long lpMs(void) { return lpDownAt > 0 ? (long)((CACurrentMediaTime() - lpDownAt) * 1000) : -1; }

#pragma mark - Describing things

static NSString *lpClass(id object) { return object ? NSStringFromClass([object class]) : @"nil"; }

static NSString *lpStateName(UIGestureRecognizerState state) {
  switch (state) {
    case UIGestureRecognizerStatePossible: return @"possible";
    case UIGestureRecognizerStateBegan: return @"began";
    case UIGestureRecognizerStateChanged: return @"changed";
    case UIGestureRecognizerStateEnded: return @"ended";
    case UIGestureRecognizerStateCancelled: return @"cancelled";
    case UIGestureRecognizerStateFailed: return @"failed";
  }
  return [NSString stringWithFormat:@"state%ld", (long)state];
}

static NSString *lpRecognizer(UIGestureRecognizer *g) {
  NSString *name = g.name.length ? [@"#" stringByAppendingString:g.name] : @"";
  return [NSString stringWithFormat:@"%@%@(%@%@)", lpClass(g), name, g.enabled ? @"" : @"DISABLED,", lpStateName(g.state)];
}

static NSString *lpView(UIView *v) {
  if (!v) return @"nil";
  CGRect r = v.window ? [v convertRect:v.bounds toView:nil] : v.frame;
  return [NSString stringWithFormat:@"%@<%p>[%.0f,%.0f %.0fx%.0f]", lpClass(v), v, r.origin.x, r.origin.y, r.size.width, r.size.height];
}

static Class lpWKContentView(void) { return NSClassFromString(@"WKContentView"); }
static Class lpWKWebView(void) { return NSClassFromString(@"WKWebView"); }

static UIView *lpAncestor(UIView *view, Class cls) {
  if (!cls) return nil;
  for (UIView *v = view; v; v = v.superview) if ([v isKindOfClass:cls]) return v;
  return nil;
}

static UIView *lpDescendant(UIView *view, Class cls, NSUInteger depth) {
  if (!cls || depth > 8) return nil;
  for (UIView *s in view.subviews) {
    if ([s isKindOfClass:cls]) return s;
    UIView *found = lpDescendant(s, cls, depth + 1);
    if (found) return found;
  }
  return nil;
}

static void lpWalk(UIView *view, NSUInteger *count, void (^visit)(UIView *)) {
  if (!view || *count > 8000) return;
  (*count)++;
  visit(view);
  for (UIView *s in view.subviews) lpWalk(s, count, visit);
}

#pragma mark - First responder

static UIWindow *lpKeyWindow(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *w in ((UIWindowScene *)scene).windows) if (w.isKeyWindow) return w;
  }
  return nil;
}

/**
 * The key window's first responder, read through UIWindow's private getter. Not
 * the nil-targeted sendAction: trick: that asks every responder in the chain
 * canPerformAction:, WKContentView included, in the middle of a touch.
 */
static id lpFirstResponder(void) {
  UIWindow *w = lpKeyWindow();
  SEL sel = NSSelectorFromString(@"firstResponder");
  if (!w || ![w respondsToSelector:sel]) return @"?";
  return ((id (*)(id, SEL))objc_msgSend)(w, sel);
}

#pragma mark - Zero-argument BOOL getters on WKContentView, read at touch-down

static NSString *lpStrip(const char *encoding) {
  NSMutableString *out = [NSMutableString new];
  for (const char *c = encoding; c && *c; c++) if (*c < '0' || *c > '9') [out appendFormat:@"%c", *c];
  return out;
}

static NSString *lpBoolGetters(id object, NSArray<NSString *> *names) {
  NSMutableArray *parts = [NSMutableArray new];
  for (NSString *name in names) {
    SEL sel = NSSelectorFromString(name);
    Method m = class_getInstanceMethod([object class], sel);
    if (!m) continue;
    NSString *enc = lpStrip(method_getTypeEncoding(m));
    if (![enc isEqualToString:@"B@:"] && ![enc isEqualToString:@"c@:"]) continue;
    BOOL value = ((BOOL (*)(id, SEL))objc_msgSend)(object, sel);
    [parts addObject:[NSString stringWithFormat:@"%@=%d", name, value]];
  }
  return [parts componentsJoinedByString:@" "];
}

#pragma mark - Snapshots

/** WebKit's text-selection loupe recognizer on this content view, with its state. */
static NSString *lpLoupe(UIView *content) {
  SEL sel = NSSelectorFromString(@"textInteractionLoupeGestureRecognizer");
  Method m = content ? class_getInstanceMethod(content.class, sel) : NULL;
  if (!m || ![lpStrip(method_getTypeEncoding(m)) isEqualToString:@"@@:"]) return @"?";
  id g = ((id (*)(id, SEL))objc_msgSend)(content, sel);
  if (![g isKindOfClass:UIGestureRecognizer.class]) return lpClass(g);
  UIGestureRecognizer *r = g;
  return [NSString stringWithFormat:@"%@ on %@ delegate=%@", lpRecognizer(r), lpView(r.view), lpClass(r.delegate)];
}

static NSString *lpContentNow(UIView *content) {
  if (!content) return @"";
  return [NSString stringWithFormat:@"content<%p> FR=%d loupe=%@ %@", content, content.isFirstResponder, lpLoupe(content),
          lpBoolGetters(content, @[@"_isSuppressingSelectionAssistant", @"isResigningFirstResponder"])];
}

static NSString *lpTouchRecognizers(UITouch *touch) {
  NSMutableArray *parts = [NSMutableArray new];
  for (UIGestureRecognizer *g in touch.gestureRecognizers) [parts addObject:[NSString stringWithFormat:@"%@@%@", lpRecognizer(g), lpClass(g.view)]];
  return [parts componentsJoinedByString:@" "];
}

static void lpSnapshotDown(UITouch *touch) {
  UIView *view = touch.view;
  UIWindow *window = touch.window;
  UIView *content = lpAncestor(view, lpWKContentView());
  UIView *web = lpAncestor(view, lpWKWebView());
  CGPoint at = [touch locationInView:nil];
  id fr = lpFirstResponder();
  NSUInteger windows = 0;
  if (@available(iOS 15.0, *)) windows = window.windowScene.windows.count;

  lp([NSString stringWithFormat:@"down #%lu at %.0f,%.0f view=%@ content=%@ web=%@ fr=%@<%p> key=%d windows=%lu",
      lpSeq, at.x, at.y, lpView(view), lpView(content), lpView(web), lpClass(fr), fr, window.isKeyWindow, (unsigned long)windows]);

  // Every WKWebView in the window: the reader, and the download's hidden Indexer when one runs.
  NSUInteger count = 0;
  NSMutableArray *webs = [NSMutableArray new];
  NSMutableArray *stuck = [NSMutableArray new];
  __block NSUInteger recognizers = 0, disabled = 0;
  Class webClass = lpWKWebView(), contentClass = lpWKContentView();
  lpWalk(window, &count, ^(UIView *v) {
    if (webClass && [v isKindOfClass:webClass]) {
      UIView *c = lpDescendant(v, contentClass, 0);
      [webs addObject:[NSString stringWithFormat:@"%@ alpha=%.2f hidden=%d content=%p contentFR=%d", lpView(v), v.alpha, v.hidden, c, c.isFirstResponder]];
    }
    for (UIGestureRecognizer *g in v.gestureRecognizers) {
      recognizers++;
      if (!g.enabled) disabled++;
      if (g.state != UIGestureRecognizerStatePossible) [stuck addObject:[NSString stringWithFormat:@"%@@%@", lpRecognizer(g), lpView(v)]];
    }
  });
  lp([NSString stringWithFormat:@"down #%lu webviews(%lu): %@", lpSeq, (unsigned long)webs.count, [webs componentsJoinedByString:@" | "]]);
  lp([NSString stringWithFormat:@"down #%lu views=%lu recognizers=%lu disabled=%lu notAtRest(%lu): %@", lpSeq, (unsigned long)count,
      (unsigned long)recognizers, (unsigned long)disabled, (unsigned long)stuck.count, [stuck componentsJoinedByString:@" "]]);

  if (content) {
    NSMutableArray *interactions = [NSMutableArray new];
    for (id<UIInteraction> i in content.interactions) [interactions addObject:lpClass(i)];
    lp([NSString stringWithFormat:@"down #%lu content interactions: %@", lpSeq, [interactions componentsJoinedByString:@" "]]);
    NSMutableArray *grs = [NSMutableArray new];
    for (UIGestureRecognizer *g in content.gestureRecognizers) [grs addObject:lpRecognizer(g)];
    lp([NSString stringWithFormat:@"down #%lu content recognizers(%lu): %@", lpSeq, (unsigned long)grs.count, [grs componentsJoinedByString:@" "]]);
    lp([NSString stringWithFormat:@"down #%lu content state: isFirstResponder=%d loupe=%@ %@", lpSeq, content.isFirstResponder, lpLoupe(content),
        lpBoolGetters(content, @[@"_isSuppressingSelectionAssistant", @"isResigningFirstResponder", @"isFocusingElement", @"_isEditable",
                                 @"isEditable", @"hasContent", @"hasText", @"_shouldSuppressSelectionCommands", @"_isBlurringFocusedElement",
                                 @"_hasFocusedElement", @"isFocusingElementWithKeyboard"])]);
  }

  NSMutableArray *scrolls = [NSMutableArray new];
  SEL interrupting = NSSelectorFromString(@"_isInterruptingDeceleration");
  for (UIView *v = view; v; v = v.superview) {
    if (![v isKindOfClass:UIScrollView.class]) continue;
    UIScrollView *s = (UIScrollView *)v;
    NSString *interrupt = @"?";
    Method m = class_getInstanceMethod(s.class, interrupting);
    if (m && ([lpStrip(method_getTypeEncoding(m)) isEqualToString:@"B@:"] || [lpStrip(method_getTypeEncoding(m)) isEqualToString:@"c@:"]))
      interrupt = ((BOOL (*)(id, SEL))objc_msgSend)(s, interrupting) ? @"1" : @"0";
    [scrolls addObject:[NSString stringWithFormat:@"%@ decel=%d drag=%d track=%d interrupting=%@ scrollEnabled=%d",
                        lpView(s), s.isDecelerating, s.isDragging, s.isTracking, interrupt, s.scrollEnabled]];
  }
  lp([NSString stringWithFormat:@"down #%lu scrolls: %@", lpSeq, [scrolls componentsJoinedByString:@" | "]]);
}

#pragma mark - -[UIApplication sendEvent:]

static IMP lpOriginalSendEvent = NULL;

static void lpInstallContentHooks(void);

static void lpSendEvent(UIApplication *self, SEL _cmd, UIEvent *event) {
  UITouch *began = nil, *finished = nil;
  if (event.type == UIEventTypeTouches) {
    NSSet<UITouch *> *all = event.allTouches;
    for (UITouch *t in all) {
      if (t.phase == UITouchPhaseBegan && all.count == 1) began = t;
      if ((t.phase == UITouchPhaseEnded || t.phase == UITouchPhaseCancelled) && t == lpTouch) finished = t;
    }
  }
  if (began) {
    lpInstallContentHooks();
    lpSeq++;
    lpDown = YES;
    lpDownAt = CACurrentMediaTime();
    lpTouch = began;
    @try { lpSnapshotDown(began); } @catch (NSException *e) { lp([NSString stringWithFormat:@"snapshot threw %@", e]); }
    unsigned long seq = lpSeq;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (!lpDown || seq != lpSeq || !lpTouch) return;
      lp([NSString stringWithFormat:@"held #%lu +%ldms fr=%@ %@ touch recognizers: %@", seq, lpMs(), lpClass(lpFirstResponder()),
          lpContentNow(lpAncestor(lpTouch.view, lpWKContentView())), lpTouchRecognizers(lpTouch)]);
    });
  }
  if (finished) {
    lp([NSString stringWithFormat:@"lift #%lu +%ldms %@ fr=%@ %@ touch recognizers: %@", lpSeq, lpMs(),
        finished.phase == UITouchPhaseCancelled ? @"cancelled" : @"ended", lpClass(lpFirstResponder()),
        lpContentNow(lpAncestor(finished.view, lpWKContentView())), lpTouchRecognizers(finished)]);
  }
  ((void (*)(id, SEL, UIEvent *))lpOriginalSendEvent)(self, _cmd, event);
  if (finished) {
    lpDown = NO;
    lpTouch = nil;
    lpActiveUntil = CACurrentMediaTime() + 1.0;
  }
}

#pragma mark - -[UIGestureRecognizer setState:]

static IMP lpOriginalSetState = NULL;

static void lpSetState(UIGestureRecognizer *self, SEL _cmd, UIGestureRecognizerState state) {
  UIGestureRecognizerState before = self.state;
  ((void (*)(id, SEL, UIGestureRecognizerState))lpOriginalSetState)(self, _cmd, state);
  if (!lpActive() || state == before) return;
  if (state == UIGestureRecognizerStateChanged || state == UIGestureRecognizerStatePossible) return;
  NSString *name = self.name.length ? [@"#" stringByAppendingString:self.name] : @"";
  lp([NSString stringWithFormat:@"gr #%lu +%ldms %@%@ %@->%@ on %@", lpSeq, lpMs(), lpClass(self), name, lpStateName(before), lpStateName(state), lpView(self.view)]);
}

#pragma mark - WKContentView's answers, by type encoding

static NSMutableDictionary<NSString *, NSValue *> *lpOriginals;

static IMP lpOriginal(SEL sel) { return (IMP)[lpOriginals[NSStringFromSelector(sel)] pointerValue]; }

static NSSet<NSString *> *lpAlwaysLogged(void) {
  static NSSet *set;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ set = [NSSet setWithArray:@[@"becomeFirstResponder", @"resignFirstResponder"]]; });
  return set;
}

/**
 * Logged at any time, not only during a touch: these change the state a later
 * long press meets, so when they happen is the evidence. A burst of the same
 * call is folded into one line a second.
 */
static void lpAlways(id self, SEL _cmd, NSString *detail) {
  static NSMutableDictionary<NSString *, NSNumber *> *last, *folded;
  if (!last) { last = [NSMutableDictionary new]; folded = [NSMutableDictionary new]; }
  NSString *key = NSStringFromSelector(_cmd);
  CFTimeInterval now = CACurrentMediaTime();
  if (!lpActive() && now - last[key].doubleValue < 1.0) { folded[key] = @(folded[key].integerValue + 1); return; }
  NSInteger skipped = folded[key].integerValue;
  last[key] = @(now);
  folded[key] = @0;
  lp([NSString stringWithFormat:@"wk #%lu +%ldms %@<%p> %@ %@%@", lpSeq, lpMs(), lpClass(self), self, key, detail,
      skipped ? [NSString stringWithFormat:@" (+%ld folded)", (long)skipped] : @""]);
}

static void lpHookVoid(id self, SEL _cmd) {
  ((void (*)(id, SEL))lpOriginal(_cmd))(self, _cmd);
  lpAlways(self, _cmd, [NSString stringWithFormat:@"(after: %@)", lpContentNow(self)]);
}

static void lpHookVoidByte(id self, SEL _cmd, unsigned char reason) {
  ((void (*)(id, SEL, unsigned char))lpOriginal(_cmd))(self, _cmd, reason);
  lpAlways(self, _cmd, [NSString stringWithFormat:@"reason=%u (after: %@)", reason, lpContentNow(self)]);
}

static BOOL lpHookNone(id self, SEL _cmd) {
  BOOL result = ((BOOL (*)(id, SEL))lpOriginal(_cmd))(self, _cmd);
  if (lpActive() || [lpAlwaysLogged() containsObject:NSStringFromSelector(_cmd)])
    lp([NSString stringWithFormat:@"wk #%lu +%ldms %@<%p> %@ -> %d", lpSeq, lpMs(), lpClass(self), self, NSStringFromSelector(_cmd), result]);
  return result;
}

static BOOL lpHookObject(id self, SEL _cmd, id argument) {
  BOOL result = ((BOOL (*)(id, SEL, id))lpOriginal(_cmd))(self, _cmd, argument);
  if (lpActive()) {
    NSString *what = [argument isKindOfClass:UIGestureRecognizer.class] ? lpRecognizer(argument) : lpClass(argument);
    lp([NSString stringWithFormat:@"wk #%lu +%ldms <%p> %@ %@ -> %d", lpSeq, lpMs(), self, NSStringFromSelector(_cmd), what, result]);
  }
  return result;
}

static BOOL lpHookPoint(id self, SEL _cmd, CGPoint point) {
  BOOL result = ((BOOL (*)(id, SEL, CGPoint))lpOriginal(_cmd))(self, _cmd, point);
  if (lpActive())
    lp([NSString stringWithFormat:@"wk #%lu +%ldms <%p> %@ (%.0f,%.0f) -> %d", lpSeq, lpMs(), self, NSStringFromSelector(_cmd), point.x, point.y, result]);
  return result;
}

static BOOL lpHookIntegerPoint(id self, SEL _cmd, NSInteger gesture, CGPoint point) {
  BOOL result = ((BOOL (*)(id, SEL, NSInteger, CGPoint))lpOriginal(_cmd))(self, _cmd, gesture, point);
  if (lpActive())
    lp([NSString stringWithFormat:@"wk #%lu +%ldms <%p> %@ gesture=%ld (%.0f,%.0f) -> %d", lpSeq, lpMs(), self, NSStringFromSelector(_cmd), (long)gesture, point.x, point.y, result]);
  return result;
}

static IMP lpHookFor(NSString *encoding) {
  if ([encoding isEqualToString:@"v@:"]) return (IMP)lpHookVoid;
  if ([encoding isEqualToString:@"v@:C"]) return (IMP)lpHookVoidByte;
  if ([encoding isEqualToString:@"B@:"] || [encoding isEqualToString:@"c@:"]) return (IMP)lpHookNone;
  if ([encoding isEqualToString:@"B@:@"] || [encoding isEqualToString:@"c@:@"]) return (IMP)lpHookObject;
  if ([encoding isEqualToString:@"B@:{CGPoint=dd}"] || [encoding isEqualToString:@"c@:{CGPoint=dd}"]) return (IMP)lpHookPoint;
  if ([encoding isEqualToString:@"B@:q{CGPoint=dd}"] || [encoding isEqualToString:@"B@:Q{CGPoint=dd}"] ||
      [encoding isEqualToString:@"c@:q{CGPoint=dd}"] || [encoding isEqualToString:@"c@:Q{CGPoint=dd}"]) return (IMP)lpHookIntegerPoint;
  return NULL;
}

static void lpInstallContentHooks(void) {
  static BOOL installed = NO;
  if (installed) return;
  Class cls = lpWKContentView();
  if (!cls) return;
  installed = YES;
  lpOriginals = [NSMutableDictionary new];
  NSArray *targets = @[@"textInteractionGesture:shouldBeginAtPoint:", @"hasSelectablePositionAtPoint:", @"gestureRecognizerShouldBegin:",
                       @"canBecomeFirstResponder", @"becomeFirstResponder", @"resignFirstResponder", @"canBecomeFirstResponderForWebView",
                       @"becomeFirstResponderForWebView", @"resignFirstResponderForWebView", @"_shouldSuppressSelectionCommands",
                       @"pointIsNearMarkedText:", @"shouldAllowHighlightLinkCreation",
                       @"_startSuppressingSelectionAssistantForReason:", @"_stopSuppressingSelectionAssistantForReason:",
                       @"cancelActiveTextInteractionGestures", @"setUpTextSelectionAssistant"];
  NSMutableArray *report = [NSMutableArray new];
  NSMutableSet *seen = [NSMutableSet new];
  NSMutableArray *related = [NSMutableArray new];
  NSRegularExpression *interesting = [NSRegularExpression regularExpressionWithPattern:
      @"shouldBegin|selectable|textInteraction|firstResponder|suppress|loupe|selectionAssistant|interactionAssistant"
      options:NSRegularExpressionCaseInsensitive error:nil];
  unsigned int n = 0;
  Method *methods = class_copyMethodList(cls, &n);
  for (unsigned int i = 0; i < n; i++) {
    NSString *name = NSStringFromSelector(method_getName(methods[i]));
    NSString *encoding = lpStrip(method_getTypeEncoding(methods[i]));
    if ([interesting firstMatchInString:name options:0 range:NSMakeRange(0, name.length)])
      [related addObject:[NSString stringWithFormat:@"%@ %@", name, encoding]];
    if (![targets containsObject:name]) continue;
    [seen addObject:name];
    IMP hook = lpHookFor(encoding);
    if (!hook) { [report addObject:[NSString stringWithFormat:@"SKIP %@ %@", name, encoding]]; continue; }
    lpOriginals[name] = [NSValue valueWithPointer:(const void *)method_setImplementation(methods[i], hook)];
    [report addObject:[NSString stringWithFormat:@"hooked %@ %@", name, encoding]];
  }
  free(methods);
  for (NSString *name in targets) if (![seen containsObject:name]) [report addObject:[NSString stringWithFormat:@"absent %@", name]];
  lp([NSString stringWithFormat:@"WKContentView hooks: %@", [report componentsJoinedByString:@", "]]);
  lp([NSString stringWithFormat:@"WKContentView related selectors(%lu): %@", (unsigned long)related.count, [related componentsJoinedByString:@", "]]);
}

@implementation ORDebugLp74Hooks

+ (void)load {
  [self install];
}

+ (void)install {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Method send = class_getInstanceMethod(UIApplication.class, @selector(sendEvent:));
    lpOriginalSendEvent = method_setImplementation(send, (IMP)lpSendEvent);
    Method set = class_getInstanceMethod(UIGestureRecognizer.class, @selector(setState:));
    lpOriginalSetState = method_setImplementation(set, (IMP)lpSetState);
    lp(@"installed sendEvent: and setState: hooks");
    dispatch_async(dispatch_get_main_queue(), ^{ lpInstallContentHooks(); });
  });
}

@end
