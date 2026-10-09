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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const lastPositionRef = useRef(0);
  const currentSongNameRef = useRef('');

  // 1. Daten beim App-Start laden
  useEffect(() => {
    loadSavedData();
  }, []);

  // 2. Automatisches Speichern bei Änderungen
  useEffect(() => {
    if (tracks.length > 0) AsyncStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(tracks));
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
      console.log('Fehler beim Laden:', e);
    }
  }

  // Live-Zeitmessung für die Rangliste
  function handlePlaybackStatusUpdate(status) {
    if (status.isLoaded && status.isPlaying) {
      if (lastPositionRef.current > 0 && status.positionMillis > lastPositionRef.current) {
        const deltaSeconds = (status.positionMillis - lastPositionRef.current) / 1000;
        if (deltaSeconds > 0 && deltaSeconds < 5) {
          setStats((prev) => {
            const songName = currentSongNameRef.current;
            if (!songName) return prev;
            return {
              ...prev,
              [songName]: (prev[songName] || 0) + deltaSeconds,
            };
          });
        }
      }
      lastPositionRef.current = status.positionMillis;
    } else if (status.isLoaded && !status.isPlaying) {
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
      console.log('Fehler Dateiauswahl:', e);
    }
  }

  // Ordner scannen
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
      Alert.alert('Hinweis', 'Ordner-Auswahl wird auf diesem Gerät evtl. nicht unterstützt.');
    }
  }

  // Song abspielen über Index
  async function playTrackByIndex(index) {
    if (index < 0 || index >= tracks.length) return;

    try {
      setLoading(true);
      const track = tracks[index];
      setCurrentTrackIndex(index);
      currentSongNameRef.current = track.name;
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
      setIsPlaying(true);
      setLoading(false);
    } catch (e) {
      console.log('Abspielfehler:', e);
      setLoading(false);
    }
  }

  // Player Steuerung: Pause / Play toggle
  async function togglePlayPause() {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      setIsPlaying(false);
    } else {
      await sound.playAsync();
      setIsPlaying(true);
    }
  }

  // Player Steuerung: Stopp
  async function stopAudio() {
    if (!sound) return;
    await sound.stopAsync();
    setIsPlaying(false);
  }

  // Nächstes / Vorheriges Lied
  function playNextTrack() {
    if (currentTrackIndex !== null && currentTrackIndex < tracks.length - 1) {
      playTrackByIndex(currentTrackIndex + 1);
    }
  }

  function playPreviousTrack() {
    if (currentTrackIndex !== null && currentTrackIndex > 0) {
      playTrackByIndex(currentTrackIndex - 1);
    }
  }

  // Playlist erstellen
  function createPlaylist() {
    if (!newPlaylistName.trim()) return;
    const newPl = { id: Date.now().toString(), name: newPlaylistName.trim(), tracks: [] };
    setPlaylists((prev) => [...prev, newPl]);
    setNewPlaylistName('');
  }

  // Lied zu einer Playlist hinzufügen
  function addTrackToPlaylist(track) {
    if (playlists.length === 0) {
      Alert.alert('Hinweis', 'Erstelle zuerst eine Playlist!');
      return;
    }

    const playlistOptions = playlists.map((pl) => ({
      text: pl.name,
      onPress: () => {
        setPlaylists((prevPlaylists) =>
          prevPlaylists.map((p) => {
            if (p.id === pl.id) {
              const alreadyExists = p.tracks.some((t) => t.id === track.id);
              if (alreadyExists) return p;
              return { ...p, tracks: [...p.tracks, track] };
            }
            return p;
          })
        );
      },
    }));

    playlistOptions.push({ text: 'Abbrechen', style: 'cancel' });

    Alert.alert('Playlist wählen', `Füge "${track.name}" hinzu zu:`, playlistOptions);
  }

  // Sortierte Rangliste
  const sortedRanking = Object.keys(stats)
    .map((name) => ({ name, seconds: Math.floor(stats[name]) }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const currentTrack = currentTrackIndex !== null ? tracks[currentTrackIndex] : null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎵 MP3 Player</Text>

      {/* Import Buttons */}
      <View style={styles.buttonRow}>
        <Button title="+ Datei" onPress={pickSingleTrack} />
        <View style={{ width: 10 }} />
        <Button title="+ Ordner" onPress={pickFolder} color="#28a745" />
      </View>

      {/* PLAYER BEREICH WITH CONTROLS */}
      <View style={styles.playerBox}>
        <Text style={styles.nowPlayingTitle}>Aktueller Titel:</Text>
        <Text style={styles.nowPlayingName} numberOfLines={1}>
          {currentTrack ? currentTrack.name : 'Kein Titel ausgewählt'}
        </Text>

        {/* Steuerungsknöpfe */}
        <View style={styles.controlsRow}>
          <TouchableOpacity style={styles.controlBtn} onPress={playPreviousTrack}>
            <Text style={styles.controlText}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtnMain} onPress={togglePlayPause}>
            <Text style={styles.controlText}>{isPlaying ? '⏸ Pause' : '▶ Play'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={stopAudio}>
            <Text style={styles.controlText}>⏹ Stopp</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlBtn} onPress={playNextTrack}>
            <Text style={styles.controlText}>⏭</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && <ActivityIndicator size="large" color="#0000ff" style={{ marginVertical: 5 }} />}

      {/* Musikbibliothek */}
      <Text style={styles.sectionTitle}>📁 Bibliothek ({tracks.length})</Text>
      <FlatList
        style={styles.list}
        data={tracks}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <View style={styles.trackItem}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => playTrackByIndex(index)}>
              <Text style={styles.trackName} numberOfLines={1}>{item.name}</Text>
            </TouchableOpacity>
            <Button title="+ Playlist" onPress={() => addTrackToPlaylist(item)} color="#6c757d" />
          </View>
        )}
      />

      {/* Playlists */}
      <Text style={styles.sectionTitle}>📜 Playlists ({playlists.length})</Text>
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
            <Text style={styles.playlistTitle}>{item.name} ({item.tracks ? item.tracks.length : 0} Songs)</Text>
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
  container: { flex: 1, padding: 15, paddingTop: 45, backgroundColor: '#f8f9fa' },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  buttonRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10 },
  playerBox: { backgroundColor: '#e9ecef', padding: 12, borderRadius: 8, marginBottom: 10, alignItems: 'center' },
  nowPlayingTitle: { fontSize: 12, color: '#6c757d' },
  nowPlayingName: { fontSize: 15, fontWeight: 'bold', marginVertical: 4 },
  controlsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  controlBtn: { padding: 8, marginHorizontal: 4, backgroundColor: '#fff', borderRadius: 5, borderWidth: 1, borderColor: '#ccc' },
  controlBtnMain: { paddingVertical: 8, paddingHorizontal: 15, marginHorizontal: 4, backgroundColor: '#007bff', borderRadius: 5 },
  controlText: { fontWeight: 'bold', color: '#000' },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', marginTop: 10, marginBottom: 4 },
  list: { maxHeight: 120 },
  trackItem: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: '#fff', marginBottom: 4, borderRadius: 5, borderWidth: 1, borderColor: '#ddd' },
  trackName: { fontSize: 13 },
  playlistInputRow: { flexDirection: 'row', marginBottom: 6 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, paddingHorizontal: 8, marginRight: 8, backgroundColor: '#fff' },
  playlistCard: { padding: 8, backgroundColor: '#fff', marginBottom: 4, borderRadius: 5, borderWidth: 1, borderColor: '#ddd' },
  playlistTitle: { fontWeight: '600', fontSize: 13 },
  rankItem: { flexDirection: 'row', justifyContent: 'space-between', padding: 6, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rankText: { flex: 1, fontSize: 12 },
  timeText: { fontWeight: 'bold', color: '#28a745', fontSize: 12 },
});
