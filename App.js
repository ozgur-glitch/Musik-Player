import React, { useState, useRef } from 'react';
import { StyleSheet, Text, View, Button, ActivityIndicator, FlatList } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Audio } from 'expo-av';

export default function App() {
  const [sound, setSound] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({}); // Speichert { "songname.mp3": sekunden }

  // Ref zur Verfolgung der Position zwischen Updates
  const lastPositionRef = useRef(0);
  const currentSongRef = useRef('');

  function handlePlaybackStatusUpdate(status) {
    if (status.isLoaded && status.isPlaying) {
      if (lastPositionRef.current > 0 && status.positionMillis > lastPositionRef.current) {
        const deltaSeconds = (status.positionMillis - lastPositionRef.current) / 1000;
        
        // Hörzeit für den aktuellen Song aufsummieren
        if (deltaSeconds > 0 && deltaSeconds < 5) { // Schutz gegen Sprünge/Seek
          setStats((prevStats) => {
            const currentSong = currentSongRef.current;
            const currentSeconds = prevStats[currentSong] || 0;
            return {
              ...prevStats,
              [currentSong]: currentSeconds + deltaSeconds,
            };
          });
        }
      }
      lastPositionRef.current = status.positionMillis;
    } else if (status.isLoaded && !status.isPlaying) {
      lastPositionRef.current = status.positionMillis;
    }
  }

  async function pickAndPlayAudio() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const file = result.assets[0];
        setFileName(file.name);
        currentSongRef.current = file.name;
        lastPositionRef.current = 0;
        setLoading(true);

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          staysActiveInBackground: false,
        });

        if (sound) {
          await sound.unloadAsync();
        }

        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: file.uri },
          { shouldPlay: true }
        );

        // Event-Listener für Zeitmessung anhängen
        newSound.setOnPlaybackStatusUpdate(handlePlaybackStatusUpdate);

        setSound(newSound);
        setLoading(false);
      }
    } catch (error) {
      console.log('Fehler beim Laden der Audio-Datei:', error);
      setLoading(false);
    }
  }

  // Sortierte Rangliste erstellen
  const sortedRanking = Object.keys(stats)
    .map((name) => ({
      name,
      seconds: Math.floor(stats[name]),
    }))
    .sort((a, b) => b.seconds - a.seconds);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mein MP3 Player</Text>

      {fileName ? (
        <Text style={styles.fileText}>Ausgewählt: {fileName}</Text>
      ) : (
        <Text style={styles.fileText}>Keine Datei ausgewählt</Text>
      )}

      {loading ? (
        <ActivityIndicator size="large" color="#0000ff" />
      ) : (
        <Button title="MP3-Datei auswählen & abspielen" onPress={pickAndPlayAudio} />
      )}

      {/* Rangliste Section */}
      <View style={styles.rankingContainer}>
        <Text style={styles.rankingTitle}>🏆 Rangliste (Hörzeit)</Text>
        {sortedRanking.length === 0 ? (
          <Text style={styles.emptyText}>Noch keine Daten vorhanden</Text>
        ) : (
          <FlatList
            data={sortedRanking}
            keyExtractor={(item) => item.name}
            renderItem={({ item, index }) => (
              <View style={styles.rankingItem}>
                <Text style={styles.rank}>{index + 1}.</Text>
                <Text style={styles.songName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.time}>{item.seconds} Sek.</Text>
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 15 },
  fileText: { fontSize: 15, marginBottom: 15, textAlign: 'center' },
  rankingContainer: { marginTop: 30, width: '100%', flex: 1 },
  rankingTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, textAlign: 'center' },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 10 },
  rankingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  rank: { fontWeight: 'bold', marginRight: 8 },
  songName: { flex: 1, marginRight: 8 },
  time: { fontWeight: '600', color: '#007AFF' },
});
