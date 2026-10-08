import React, { useState } from 'react';
import { StyleSheet, Text, View, Button } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';

export default function App() {
  const [sound, setSound] = useState();

  async function pickAndPlayAudio() {
    // MP3-Datei vom Smartphone auswählen
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/mpeg',
    });

    if (!result.canceled && result.assets[0]) {
      // Alten Sound stoppen, falls bereits einer läuft
      if (sound) {
        await sound.unloadAsync();
      }

      // Neue Datei laden und abspielen
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: result.assets[0].uri },
        { shouldPlay: true }
      );
      setSound(newSound);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mein MP3 Player</Text>
      <Button title="MP3-Datei auswählen & abspielen" onPress={pickAndPlayAudio} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 20, marginBottom: 20 },
});
