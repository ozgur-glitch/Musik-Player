import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  TextInput,
  Alert,
  StatusBar,
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

  useEffect(() => {
    loadSavedData();
  }, []);

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
      Alert.alert('Hinweis', 'Ordner-Auswahl wird auf diesem Gerät nicht unterstützt.');
    }
  }

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

  async function stopAudio() {
    if (!sound) return;
    await sound.stopAsync();
    setIsPlaying(false);
  }

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

  function createPlaylist() {
    if (!newPlaylistName.trim()) return;
    const newPl = { id: Date.now().toString(), name: newPlaylistName.trim(), tracks: [] };
    setPlaylists((prev) => [...prev, newPl]);
    setNewPlaylistName('');
  }

  function addTrackToPlaylist(track) {
    if (playlists.length === 0) {
      Alert.alert('CyberPlayer Alert', 'Erstelle zuerst eine Playlist!');
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
    Alert.alert('Playlist Hinzufügen', `Titel "${track.name}" hinzufügen zu:`, playlistOptions);
  }

  const sortedRanking = Object.keys(stats)
    .map((name) => ({ name, seconds: Math.floor(stats[name]) }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const currentTrack = currentTrackIndex !== null ? tracks[currentTrackIndex] : null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0b0e14" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.appTitle}>NEXUS<Text style={styles.titleAccent}>AUDIO</Text></Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{isPlaying ? 'LIVE AUDIO' : 'STANDBY'}</Text>
        </View>
      </View>

      {/* Futuristic Player Display */}
      <View style={styles.playerCard}>
        <View style={styles.visualizerContainer}>
          <View style={[styles.bar, isPlaying && styles.barActive1]} />
          <View style={[styles.bar, isPlaying && styles.barActive2]} />
          <View style={[styles.bar, isPlaying && styles.barActive3]} />
          <View style={[styles.bar, isPlaying && styles.barActive2]} />
          <View style={[styles.bar, isPlaying && styles.barActive1]} />
        </View>

        <Text style={styles.nowPlayingLabel}>AKTUELLES AUDIO-SIGNAL</Text>
        <Text style={styles.trackTitle} numberOfLines={1}>
          {currentTrack ? currentTrack.name : 'Kein Titel geladen'}
        </Text>

        {/* Control Cluster */}
        <View style={styles.controlCluster}>
          <TouchableOpacity style={styles.iconBtn} onPress={playPreviousTrack}>
            <Text style={styles.iconText}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.mainPlayBtn} onPress={togglePlayPause}>
            <Text style={styles.mainPlayText}>{isPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={stopAudio}>
            <Text style={styles.iconText}>⏹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={playNextTrack}>
            <Text style={styles.iconText}>⏭</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Import Action Bar */}
      <View style={styles.importRow}>
        <TouchableOpacity style={styles.cyanBtn} onPress={pickSingleTrack}>
          <Text style={styles.btnText}>+ DATEI LADEN</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.purpleBtn} onPress={pickFolder}>
          <Text style={styles.btnText}>+ ORDNER SCAN</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="large" color="#00f2fe" style={{ marginVertical: 8 }} />}

      {/* Section: Audio Library */}
      <Text style={styles.sectionHeader}>// BIBLIOTHEK ({tracks.length})</Text>
      <FlatList
        style={styles.scrollList}
        data={tracks}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <View style={[styles.listItem, currentTrackIndex === index && styles.activeListItem]}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => playTrackByIndex(index)}>
              <Text style={styles.itemText} numberOfLines={1}>{item.name}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.miniBtn} onPress={() => addTrackToPlaylist(item)}>
              <Text style={styles.miniBtnText}>+ LISTE</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      {/* Section: Playlists */}
      <Text style={styles.sectionHeader}>// PLAYLISTS ({playlists.length})</Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.darkInput}
          placeholder="Neue Playlist Benennen..."
          placeholderTextColor="#5a6578"
          value={newPlaylistName}
          onChangeText={setNewPlaylistName}
        />
        <TouchableOpacity style={styles.addBtn} onPress={createPlaylist}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        style={styles.scrollList}
        data={playlists}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.playlistCard}>
            <Text style={styles.playlistName}>{item.name}</Text>
            <Text style={styles.playlistCount}>{item.tracks ? item.tracks.length : 0} TITEL</Text>
          </View>
        )}
      />

      {/* Section: Rank Stats */}
      <Text style={styles.sectionHeader}>// HÖRZEIT-RANGLISTE</Text>
      <FlatList
        style={styles.scrollList}
        data={sortedRanking}
        keyExtractor={(item) => item.name}
        renderItem={({ item, index }) => (
          <View style={styles.rankCard}>
            <Text style={styles.rankNum}>#{index + 1}</Text>
            <Text style={styles.rankName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.rankTime}>{item.seconds}s</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0e14', paddingHorizontal: 16, paddingTop: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  appTitle: { fontSize: 22, fontWeight: '900', color: '#ffffff', letterSpacing: 1.5 },
  titleAccent: { color: '#00f2fe' },
  statusBadge: { backgroundColor: 'rgba(0,242,254,0.1)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 4, borderWidth: 1, borderColor: '#00f2fe' },
  statusText: { fontSize: 9, fontWeight: 'bold', color: '#00f2fe', letterSpacing: 1 },
  
  // Futuristic Player Card
  playerCard: { backgroundColor: '#161b22', borderRadius: 16, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#232d3d', marginBottom: 12 },
  visualizerContainer: { flexDirection: 'row', alignItems: 'flex-end', height: 20, marginBottom: 10, gap: 4 },
  bar: { width: 4, height: 6, backgroundColor: '#232d3d', borderRadius: 2 },
  barActive1: { height: 16, backgroundColor: '#00f2fe' },
  barActive2: { height: 20, backgroundColor: '#4facfe' },
  barActive3: { height: 12, backgroundColor: '#00f2fe' },
  nowPlayingLabel: { fontSize: 10, color: '#5a6578', letterSpacing: 1, fontWeight: 'bold' },
  trackTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginVertical: 6 },
  
  controlCluster: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12 },
  iconBtn: { width: 42, height: 42, backgroundColor: '#1f2633', borderRadius: 21, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2d3748' },
  iconText: { color: '#fff', fontSize: 16 },
  mainPlayBtn: { width: 56, height: 56, backgroundColor: '#00f2fe', borderRadius: 28, justifyContent: 'center', alignItems: 'center' },
  mainPlayText: { color: '#0b0e14', fontSize: 22, fontWeight: 'bold' },

  importRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  cyanBtn: { flex: 1, backgroundColor: 'rgba(0,242,254,0.15)', borderWidth: 1, borderColor: '#00f2fe', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  purpleBtn: { flex: 1, backgroundColor: 'rgba(121,40,202,0.15)', borderWidth: 1, borderColor: '#7928ca', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5 },

  sectionHeader: { fontSize: 11, fontWeight: 'bold', color: '#5a6578', letterSpacing: 1, marginTop: 8, marginBottom: 6 },
  scrollList: { maxHeight: 110 },
  
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#161b22', padding: 10, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: '#1f2633' },
  activeListItem: { borderColor: '#00f2fe', backgroundColor: 'rgba(0,242,254,0.05)' },
  itemText: { color: '#e2e8f0', fontSize: 13, fontWeight: '500' },
  miniBtn: { backgroundColor: '#232d3d', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  miniBtnText: { color: '#00f2fe', fontSize: 10, fontWeight: 'bold' },

  inputContainer: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  darkInput: { flex: 1, backgroundColor: '#161b22', borderWidth: 1, borderColor: '#232d3d', borderRadius: 8, paddingHorizontal: 12, color: '#fff', fontSize: 13 },
  addBtn: { width: 40, height: 40, backgroundColor: '#00f2fe', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  addBtnText: { color: '#0b0e14', fontSize: 20, fontWeight: 'bold' },

  playlistCard: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#161b22', padding: 10, borderRadius: 8, marginBottom: 6, borderWidth: 1, borderColor: '#1f2633' },
  playlistName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  playlistCount: { color: '#00f2fe', fontSize: 11, fontWeight: 'bold' },

  rankCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161b22', padding: 8, borderRadius: 8, marginBottom: 4, borderWidth: 1, borderColor: '#1f2633' },
  rankNum: { color: '#00f2fe', fontWeight: 'bold', width: 28, fontSize: 12 },
  rankName: { flex: 1, color: '#cbd5e1', fontSize: 12 },
  rankTime: { color: '#7928ca', fontWeight: 'bold', fontSize: 12 },
});
