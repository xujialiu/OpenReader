// Run in the simulator. Inspects Apple's own animation package, not app code.
#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <dlfcn.h>
int main(int argc, const char **argv) { @autoreleasepool {
  if (argc != 2) { puts("usage: check-media-resources ABSOLUTE_PACKAGE_PATH"); return 2; }
  NSString *directory = [NSString stringWithUTF8String:argv[1]];
  NSDictionary *index = [NSDictionary dictionaryWithContentsOfFile:[directory stringByAppendingPathComponent:@"index.xml"]];
  for (NSString *key in @[@"rootDocument", @"assetManifest"]) {
    NSString *file = index[key];
    printf("%s: %s exists=%d\n", key.UTF8String, file.UTF8String,
      file && [[NSFileManager defaultManager] fileExistsAtPath:[directory stringByAppendingPathComponent:file]]);
  }
  void *library = dlopen("/System/Library/Frameworks/QuartzCore.framework/QuartzCore", RTLD_NOW);
  NSString **type = dlsym(library, "kCAPackageTypeCAMLBundle");
  Class cls = NSClassFromString(@"CAPackage");
  SEL selector = NSSelectorFromString(@"packageWithContentsOfURL:type:options:error:");
  if (!type || ![cls respondsToSelector:selector]) { puts("CAPackage inspection unavailable"); return 2; }
  NSError *error = nil;
  id package = ((id(*)(id,SEL,id,id,id,NSError**))objc_msgSend)(cls,selector,[NSURL fileURLWithPath:directory],*type,nil,&error);
  CALayer *root = [package valueForKey:@"rootLayer"];
  printf("package=%s root=%s sublayers=%lu error=%s\n", package?"present":"nil",root?"present":"nil",(unsigned long)root.sublayers.count,error.description.UTF8String ?: "none");
  // Also ask the actual MediaControls asset factory, rather than assuming that
  // its resource lookup is the same as the direct CAPackage load above.
  void *media = dlopen("/System/Library/PrivateFrameworks/MediaControls.framework/MediaControls", RTLD_NOW);
  Class assetClass = NSClassFromString(@"MRUCAPackageAsset");
  SEL factory = NSSelectorFromString(@"packageNamed:glyphState:");
  if (media && [assetClass respondsToSelector:factory]) {
    id asset = ((id(*)(id,SEL,id,id))objc_msgSend)(assetClass,factory,@"PlayPauseStop",@"play");
    id actual = [asset valueForKey:@"package"];
    printf("MediaControls PlayPauseStop: package=%s root=%s\n",
      actual?"present":"nil",[actual valueForKey:@"rootLayer"]?"present":"nil");
  } else {
    puts("MediaControls asset factory unavailable; direct package result only");
  }
  return root ? 0 : 1;
}}
