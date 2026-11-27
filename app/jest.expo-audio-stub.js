// expo-audio's native module doesn't load under Jest. Screens that never play anything (and sign-out, which stops the
// podcast player) get this stand-in; tests of playing mock 'expo-audio' themselves.
module.exports = {
  createAudioPlayer: () => {
    throw new Error('expo-audio is not available in tests: mock it');
  },
  setAudioModeAsync: async () => {},
};
