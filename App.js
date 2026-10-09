import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Button,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY_TRACKS = '@music_player_tracks';
const STORAGE_KEY_PLAYLISTS = '@music_player_playlists';
const STORAGE_KEY_STATS = '@music_player_stats';

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [stats, setStats] = useState({});
  
  const [sound, setSound] = useState(null);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [loading, setLoading] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const lastPositionRef = useRef(0);
  const currentSongRef = useRef('');

  // 1. Beim App-Start gespeicherte Daten laden
  useEffect(() => {
    loadSavedData();
  }, []);

  // 2. Daten automatisch speichern, wenn sie sich ändern
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(tracks));
  }, [tracks]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY_PLAYLISTS, JSON.stringify(playlists));
  }, [playlists]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
  }, [stats]);

  async function loadSavedData() {
    try {
      const savedTracks = await AsyncStorage.getItem(STORAGE_KEY_TRACKS);
      const savedPlaylists = await AsyncStorage.getItem(STORAGE_KEY_PLAYLISTS);
      const savedStats = await AsyncStorage.getItem(STORAGE_KEY_STATS);

      if (savedTracks) setTracks(JSON.parse(savedTracks));
      if (savedPlaylists) setPlaylists(JSON.parse(savedPlaylists));
      if (savedStats) setStats(JSON.parse(savedStats));
    } catch (e) {
      console.log('Fehler beim Laden der Daten:', e);
    }
  }

  // Tracking-System für Hörzeit
  function handlePlaybackStatusUpdate(status) {
    if (status.isLoaded && status.isPlaying) {
      if (lastPositionRef.current > 0 && status.positionMillis > lastPositionRef.current) {
        const deltaSeconds = (status.positionMillis - lastPositionRef.current) / 1000;
        if (deltaSeconds > 0 && deltaSeconds < 5) {
          setStats((prev) => ({
            ...prev,
            [currentSongRef.current]: (prev[currentSongRef.current] || 0) + deltaSeconds,
          }));
        }
      }
      lastPositionRef.current = status.positionMillis;
    }
  }

  // Einzelne MP3 hinzufügen
  async function pickSingleTrack() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const file = result.assets[0];
        const newTrack = { id: Date.now().toString(), name: file.name, uri: file.uri };
        
        setTracks((prev) => {
          if (prev.some((t) => t.name === file.name)) return prev;
          return [...prev, newTrack];
        });
      }
    } catch (e) {
      console.log('Fehler bei Dateiauswahl:', e);
    }
  }

  // Ganzen Ordner auf Android auswählen & nach MP3s scannen
  async function pickFolder() {
    try {
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return;

      setLoading(true);
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(permissions.directoryUri);
      
      const mp3Files = files.filter((uri) => uri.endsWith('.mp3') || uri.includes('.mp3'));
      const newTracks = mp3Files.map((uri, index) => {
        const decoded = decodeURIComponent(uri);
        const name = decoded.substring(decoded.lastIndexOf('/') + 1);
        return { id: `${Date.now()}_${index}`, name, uri };
      });

      setTracks((prev) => {
        const existingNames = new Set(prev.map((t) => t.name));
        const filteredNew = newTracks.filter((t) => !existingNames.has(t.name));
        return [...prev, ...filteredNew];
      });

      setLoading(false);
    } catch (e) {
      console.log('Ordner-Scan Fehler:', e);
      setLoading(false);
      Alert.alert('Hinweis', 'Ordner-Auswahl wird auf diesem Gerät evtl. nicht unterstützt. Nutze Einzeldateien.');
    }
  }

  // Song abspielen
  async function playTrack(track) {
    try {
      setLoading(true);
      setCurrentTrack(track);
      currentSongRef.current = track.name;
      lastPositionRef.current = 0;

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
        { uri: track.uri },
        { shouldPlay: true }
      );

      newSound.setOnPlaybackStatusUpdate(handlePlaybackStatusUpdate);
      setSound(newSound);
      setLoading(false);
    } catch (e) {
      console.log('Abspielfehler:', e);
      setLoading(false);
    }
  }

  // Playlist erstellen
  function createPlaylist() {
    if (!newPlaylistName.trim()) return;
    const newPl = { id: Date.now().toString(), name: newPlaylistName.trim(), trackIds: [] };
    setPlaylists((prev) => [...prev, newPl]);
    setNewPlaylistName('');
  }

  // Sortierte Rangliste
  const sortedRanking = Object.keys(stats)
    .map((name) => ({ name, seconds: Math.floor(stats[name]) }))
    .sort((a, b) => b.seconds - a.seconds);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎵 Mein MP3 Player</Text>

      {/* Buttons zum Hinzufügen */}
      <View style={styles.buttonRow}>
        <Button title="+ Datei" onPress={pickSingleTrack} />
        <View style={{ width: 10 }} />
        <Button title="+ Ordner" onPress={pickFolder} color="#28a745" />
      </View>

      {/* Aktuell laufender Song */}
      {currentTrack && (
        <Text style={styles.nowPlaying}>▶ Läuft: {currentTrack.name}</Text>
      )}

      {loading && <ActivityIndicator size="large" color="#0000ff" style={{ marginVertical: 10 }} />}

      {/* Musikbibliothek */}
      <Text style={styles.sectionTitle}>📁 Musikbibliothek ({tracks.length})</Text>
      <FlatList
        style={styles.list}
        data={tracks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.trackItem} onPress={() => playTrack(item)}>
            <Text style={styles.trackName} numberOfLines={1}>{item.name}</Text>
          </TouchableOpacity>
        )}
      />

      {/* Playlists Bereich */}
      <Text style={styles.sectionTitle}>📜 Playlists</Text>
      <View style={styles.playlistInputRow}>
        <TextInput
          style={styles.input}
          placeholder="Neue Playlist..."
          value={newPlaylistName}
          onChangeText={setNewPlaylistName}
        />
        <Button title="Erstellen" onPress={createPlaylist} />
      </View>

      <FlatList
        style={styles.list}
        data={playlists}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.playlistCard}>
            <Text style={styles.playlistTitle}>{item.name} ({item.trackIds.length} Songs)</Text>
          </View>
        )}
      />

      {/* Rangliste */}
      <Text style={styles.sectionTitle}>🏆 Rangliste (Hörzeit)</Text>
      <FlatList
        style={styles.list}
        data={sortedRanking}
        keyExtractor={(item) => item.name}
        renderItem={({ item, index }) => (
          <View style={styles.rankItem}>
            <Text style={styles.rankText}>{index + 1}. {item.name}</Text>
            <Text style={styles.timeText}>{item.seconds}s</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 15, paddingTop: 50, backgroundColor: '#f8f9fa' },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 15 },
  buttonRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 15 },
  nowPlaying: { fontSize: 14, fontWeight: 'bold', color: '#007bff', textAlign: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginTop: 15, marginBottom: 5 },
  list: { maxHeight: 150 },
  trackItem: { padding: 10, backgroundColor: '#fff', marginBottom: 5, borderRadius: 5, borderWidth: 1, borderColor: '#ddd' },
  trackName: { fontSize: 14 },
  playlistInputRow: { flexDirection: 'row', marginBottom: 10 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, paddingHorizontal: 10, marginRight: 10, backgroundColor: '#fff' },
  playlistCard: { padding: 8, backgroundColor: '#e9ecef', marginBottom: 5, borderRadius: 5 },
  playlistTitle: { fontWeight: '600' },
  rankItem: { flexDirection: 'row', justifyContent: 'space-between', padding: 6, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rankText: { flex: 1, fontSize: 13 },
  timeText: { fontWeight: 'bold', color: '#28a745' },
});
