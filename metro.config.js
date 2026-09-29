// The Expo default configuration, plus one exclusion: the sub-worktrees in
// ./.worktrees (AGENTS.md, "Sub-worktrees"), each a whole checkout of this
// repository with its own node_modules, which Metro would otherwise crawl.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  // Project-relative, as Expo's file map applies its patterns while crawling
  // (the same form as Expo's own `ios/Pods` entry).
  /^\.worktrees$/,
  // Absolute, as Metro resolves. Anchored at this project's root: a
  // sub-worktree running its own Metro has `/.worktrees/` in all its paths.
  new RegExp('^' + escape(path.join(__dirname, '.worktrees')) + '(?:[\\\\/]|$)'),
];

module.exports = config;
