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
  const [expandedPlaylistId, setExpandedPlaylistId] = useState(null);

  const lastPositionRef = useRef(0);
  const currentSongNameRef = useRef('');

  // 1. Beim App-Start gespeicherte Daten laden
  useEffect(() => {
    loadSavedData();
  }, []);

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

  // Hilfsfunktionen zum dauerhaften Speichern
  async function saveTracks(newTracks) {
    setTracks(newTracks);
    await AsyncStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(newTracks));
  }

  async function savePlaylists(newPlaylists) {
    setPlaylists(newPlaylists);
    await AsyncStorage.setItem(STORAGE_KEY_PLAYLISTS, JSON.stringify(newPlaylists));
  }

  async function saveStats(newStats) {
    setStats(newStats);
    await AsyncStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(newStats));
  }

  // Ranglisten-Zeitmessung
  function handlePlaybackStatusUpdate(status) {
    if (status.isLoaded && status.isPlaying) {
      if (lastPositionRef.current > 0 && status.positionMillis > lastPositionRef.current) {
        const deltaSeconds = (status.positionMillis - lastPositionRef.current) / 1000;
        if (deltaSeconds > 0 && deltaSeconds < 5) {
          const songName = currentSongNameRef.current;
          if (songName) {
            setStats((prev) => {
              const updated = {
                ...prev,
                [songName]: (prev[songName] || 0) + deltaSeconds,
              };
              AsyncStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(updated));
              return updated;
            });
          }
        }
      }
      lastPositionRef.current = status.positionMillis;
    } else if (status.isLoaded && !status.isPlaying) {
      lastPositionRef.current = status.positionMillis;
    }
  }

  // Einzeldatei hinzufügen
  async function pickSingleTrack() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const file = result.assets[0];
        const newTrack = { id: Date.now().toString(), name: file.name, uri: file.uri };

        if (!tracks.some((t) => t.name === file.name)) {
          const updated = [...tracks, newTrack];
          saveTracks(updated);
        }
      }
    } catch (e) {
      console.log('Fehler bei Dateiauswahl:', e);
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

      const existingNames = new Set(tracks.map((t) => t.name));
      const filteredNew = newTracks.filter((t) => !existingNames.has(t.name));
      const updated = [...tracks, ...filteredNew];

      saveTracks(updated);
      setLoading(false);
    } catch (e) {
      console.log('Ordner-Scan Fehler:', e);
      setLoading(false);
      Alert.alert('Hinweis', 'Ordner-Auswahl auf diesem Gerät nicht verfügbar.');
    }
  }

  // Abspielen
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

  // Player-Steuerung
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

  // Playlist erstellen
  function createPlaylist() {
    if (!newPlaylistName.trim()) return;
    const newPl = { id: Date.now().toString(), name: newPlaylistName.trim(), tracks: [] };
    const updated = [...playlists, newPl];
    savePlaylists(updated);
    setNewPlaylistName('');
  }

  // Song zu Playlist hinzufügen
  function addTrackToPlaylist(track) {
    if (playlists.length === 0) {
      Alert.alert('Hinweis', 'Erstelle zuerst eine Playlist!');
      return;
    }

    const playlistOptions = playlists.map((pl) => ({
      text: pl.name,
      onPress: () => {
        const updated = playlists.map((p) => {
          if (p.id === pl.id) {
            const alreadyExists = p.tracks.some((t) => t.id === track.id);
            if (alreadyExists) return p;
            return { ...p, tracks: [...p.tracks, track] };
          }
          return p;
        });
        savePlaylists(updated);
      },
    }));

    playlistOptions.push({ text: 'Abbrechen', style: 'cancel' });
    Alert.alert('Zu Playlist hinzufügen', `Wähle eine Playlist für "${track.name}":`, playlistOptions);
  }

  // Rangliste Daten
  const sortedRanking = Object.keys(stats)
    .map((name) => ({ name, seconds: Math.floor(stats[name]) }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const currentTrack = currentTrackIndex !== null ? tracks[currentTrackIndex] : null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e2638" />

      {/* Navigation Header */}
      <View style={styles.navBar}>
        <Text style={styles.navBack}>←</Text>
        <Text style={styles.navTitle}>Songs</Text>
        <View style={styles.navIcons}>
          <Text style={styles.navIcon}>🔍</Text>
          <Text style={styles.navIcon}>⋮</Text>
        </View>
      </View>

      {/* Buttons für Import */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={pickSingleTrack}>
          <Text style={styles.actionBtnText}>+ DATEI</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={pickFolder}>
          <Text style={styles.actionBtnText}>+ ORDNER</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="small" color="#ffd700" style={{ marginVertical: 4 }} />}

      {/* Musikbibliothek */}
      <FlatList
        style={styles.mainList}
        data={tracks}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={() => (
          <>
            {/* Playlists Bereich */}
            <Text style={styles.sectionTitle}>PLAYLISTS ({playlists.length})</Text>
            <View style={styles.playlistInputRow}>
              <TextInput
                style={styles.input}
                placeholder="Neue Playlist Name..."
                placeholderTextColor="#8a95a5"
                value={newPlaylistName}
                onChangeText={setNewPlaylistName}
              />
              <TouchableOpacity style={styles.createBtn} onPress={createPlaylist}>
                <Text style={styles.createBtnText}>Erstellen</Text>
              </TouchableOpacity>
            </View>

            {playlists.map((pl) => (
              <View key={pl.id} style={styles.playlistBox}>
                <TouchableOpacity
                  style={styles.playlistHeader}
                  onPress={() => setExpandedPlaylistId(expandedPlaylistId === pl.id ? null : pl.id)}
                >
                  <Text style={styles.playlistNameText}>
                    📜 {pl.name} ({pl.tracks ? pl.tracks.length : 0} Songs)
                  </Text>
                  <Text style={{ color: '#8a95a5' }}>{expandedPlaylistId === pl.id ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {/* Aufgeklappte Playlist-Inhalte */}
                {expandedPlaylistId === pl.id && (
                  <View style={styles.playlistContent}>
                    {pl.tracks && pl.tracks.length > 0 ? (
                      pl.tracks.map((t, i) => (
                        <View key={i} style={styles.playlistSubItem}>
                          <Text style={styles.playlistSubText} numberOfLines={1}>• {t.name}</Text>
                        </View>
                      ))
                    ) : (
                      <Text style={{ color: '#8a95a5', fontSize: 12, paddingVertical: 4 }}>
                        Keine Songs in dieser Playlist
                      </Text>
                    )}
                  </View>
                )}
              </View>
            ))}

            {/* Rangliste Bereich */}
            <Text style={styles.sectionTitle}>🏆 RANGLISTE (HÖRZEIT)</Text>
            {sortedRanking.length === 0 ? (
              <Text style={{ color: '#8a95a5', fontSize: 13, marginBottom: 15 }}>Noch keine Daten vorhanden</Text>
            ) : (
              sortedRanking.map((item, idx) => (
                <View key={idx} style={styles.rankRow}>
                  <Text style={styles.rankNum}>{idx + 1}.</Text>
                  <Text style={styles.rankName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.rankTime}>{item.seconds} Sek.</Text>
                </View>
              ))
            )}

            <Text style={styles.sectionTitle}>ALLE SONGS ({tracks.length})</Text>
          </>
        )}
        renderItem={({ item, index }) => {
          const isSelected = currentTrackIndex === index;
          return (
            <View style={styles.songRow}>
              {/* Cover Icon */}
              <View style={styles.coverBox}>
                <Text style={{ fontSize: 18 }}>🎵</Text>
              </View>

              {/* Song Titel */}
              <TouchableOpacity style={{ flex: 1 }} onPress={() => playTrackByIndex(index)}>
                <Text style={[styles.songTitle, isSelected && styles.activeSongTitle]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.songArtist}>MP3 Audio</Text>
              </TouchableOpacity>

              {/* Dreipunkte Menü / Playlist Button */}
              <TouchableOpacity style={styles.moreBtn} onPress={() => addTrackToPlaylist(item)}>
                <Text style={styles.moreBtnText}>⋮</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {/* Untere Player-Steuerung */}
      {currentTrack && (
        <View style={styles.bottomPlayer}>
          <Text style={styles.nowPlayingText} numberOfLines={1}>
            ▶ {currentTrack.name}
          </Text>
          <View style={styles.controls}>
            <TouchableOpacity onPress={playPreviousTrack} style={styles.cBtn}>
              <Text style={styles.cText}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={styles.cBtnMain}>
              <Text style={styles.cTextMain}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={stopAudio} style={styles.cBtn}>
              <Text style={styles.cText}>⏹</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={playNextTrack} style={styles.cBtn}>
              <Text style={styles.cText}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#2d384e', paddingTop: 35 },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  navBack: { color: '#ffffff', fontSize: 22 },
  navTitle: { color: '#ffffff', fontSize: 22, fontWeight: '500', flex: 1, marginLeft: 15 },
  navIcons: { flexDirection: 'row', gap: 15 },
  navIcon: { color: '#ffffff', fontSize: 20 },

  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  actionBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  actionBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },

  mainList: { flex: 1, paddingHorizontal: 16 },
  sectionTitle: { color: '#8a95a5', fontSize: 12, fontWeight: 'bold', marginTop: 15, marginBottom: 8, letterSpacing: 1 },

  songRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  coverBox: { width: 48, height: 48, backgroundColor: '#1e2638', borderRadius: 4, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  songTitle: { color: '#ffffff', fontSize: 16, fontWeight: '400', marginBottom: 3 },
  activeSongTitle: { color: '#ffd700', fontWeight: 'bold' },
  songArtist: { color: '#8a95a5', fontSize: 13 },
  moreBtn: { padding: 10 },
  moreBtnText: { color: '#ffffff', fontSize: 20 },

  playlistInputRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input: { flex: 1, backgroundColor: '#1e2638', borderRadius: 6, paddingHorizontal: 12, color: '#ffffff', fontSize: 13 },
  createBtn: { backgroundColor: '#ffd700', paddingHorizontal: 14, justifyContent: 'center', borderRadius: 6 },
  createBtnText: { color: '#1e2638', fontWeight: 'bold', fontSize: 13 },

  playlistBox: { backgroundColor: '#1e2638', borderRadius: 6, marginBottom: 6, padding: 10 },
  playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  playlistNameText: { color: '#ffffff', fontSize: 14, fontWeight: '500' },
  playlistContent: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  playlistSubItem: { paddingVertical: 4 },
  playlistSubText: { color: '#cbd5e1', fontSize: 13 },

  rankRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  rankNum: { color: '#ffd700', fontWeight: 'bold', width: 24 },
  rankName: { flex: 1, color: '#ffffff', fontSize: 13 },
  rankTime: { color: '#8a95a5', fontSize: 13, fontWeight: 'bold' },

  bottomPlayer: { backgroundColor: '#1e2638', padding: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  nowPlayingText: { color: '#ffd700', fontSize: 13, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  cBtn: { padding: 6 },
  cText: { color: '#ffffff', fontSize: 18 },
  cBtnMain: { backgroundColor: '#ffd700', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  cTextMain: { color: '#1e2638', fontSize: 18, fontWeight: 'bold' },
});
