// Icons load a font asset that jest can't resolve; render the icon name as text instead.
const React = require('react');
const { Text } = require('react-native');

function Ionicons({ name }) {
  return React.createElement(Text, null, name);
}
Ionicons.glyphMap = {};

module.exports = { __esModule: true, default: Ionicons };
