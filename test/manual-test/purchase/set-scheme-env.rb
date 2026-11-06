# Sets/updates EnvironmentVariables in a shared scheme's TestAction.
#
#   ruby set-scheme-env.rb PATH/TO/StoreKitUI.xcscheme PROBE_MODE establish
#   ruby set-scheme-env.rb PATH/TO/StoreKitUI.xcscheme EXPECTED_TX 'a#1,b#2'
#
# xcodebuild does not forward TEST_RUNNER_-prefixed environment to the runner on
# this setup (measured 2026-11-06: every test saw MISSING), so the mode and the
# expected-transaction ledger travel inside the scheme itself, where the test
# action can read them as ProcessInfo.environment entries.
require 'cgi'
scheme_path = ARGV[0]
key = ARGV[1]
value = ARGV[2]
abort 'usage: set-scheme-env.rb SCHEME.xcscheme KEY VALUE' unless scheme_path && key && value
text = File.read(scheme_path)
# shouldUseLaunchSchemeArgsEnv=YES makes the TEST action ignore its own
# EnvironmentVariables (it inherits the Run action's), so the mode never
# reached the runner (measured 2026-11-06). It must be NO for the scheme
# variables to apply.
text = text.sub(/(<TestAction[^>]*?)shouldUseLaunchSchemeArgsEnv = "YES"/i, '\1shouldUseLaunchSchemeArgsEnv = "NO"')
entry = %(<EnvironmentVariable key="#{key}" value="#{CGI.escapeHTML(value)}"/>) 
if text.include?(%(key="#{key}"))
  text = text.gsub(%r{<EnvironmentVariable key="#{key}" value="[^"]*"/>}, entry)
elsif text.include?('<EnvironmentVariables>')
  text = text.sub('<EnvironmentVariables>', "<EnvironmentVariables>\n      #{entry}")
else
  text = text.sub(/(<TestAction[^>]*>)/i) { Regexp.last_match(1) + "\n      <EnvironmentVariables>\n      #{entry}\n      </EnvironmentVariables>" }
end
File.write(scheme_path, text)
puts "#{scheme_path}: #{key}=#{value}"
