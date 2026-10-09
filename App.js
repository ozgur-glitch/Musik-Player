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
import Slider from '@react-native-community/slider';

const STORAGE_KEY_TRACKS = '@music_player_tracks';
const STORAGE_KEY_PLAYLISTS = '@music_player_playlists';
const STORAGE_KEY_STATS = '@music_player_stats';

// Hilfsfunktion: Teilt "Interpret - Titel.mp3" sauber auf
function parseSongName(filename) {
  if (!filename) return { artist: 'Unbekannter Interpret', title: 'Unbekannter Titel' };
  const cleanName = filename.replace(/\.[^/.]+$/, ''); // .mp3 entfernen
  const parts = cleanName.split('-');
  if (parts.length > 1) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join('-').trim(),
    };
  }
  return {
    artist: 'Unbekannter Interpret',
    title: cleanName.trim(),
  };
}

// Zeitformatierung (Millisekunden zu MM:SS)
function formatTime(millis) {
  if (!millis || isNaN(millis)) return '0:00';
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [stats, setStats] = useState({});

  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(null);
  const [loading, setLoading] = useState(false);

  // Suche & UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [expandedPlaylistId, setExpandedPlaylistId] = useState(null);

  // Position & Slider Status
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(1);
  const [isSeeking, setIsSeeking] = useState(false);

  const lastPositionRef = useRef(0);
  const currentSongNameRef = useRef('');

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

  async function saveTracks(newTracks) {
    setTracks(newTracks);
    await AsyncStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(newTracks));
  }

  async function savePlaylists(newPlaylists) {
    setPlaylists(newPlaylists);
    await AsyncStorage.setItem(STORAGE_KEY_PLAYLISTS, JSON.stringify(newPlaylists));
  }

  // Live Status-Update für Fortschrittsbalken und Hörzeit-Rangliste
  function handlePlaybackStatusUpdate(status) {
    if (status.isLoaded) {
      if (!isSeeking) {
        setPositionMillis(status.positionMillis || 0);
        setDurationMillis(status.durationMillis || 1);
      }
      setIsPlaying(status.isPlaying);

      if (status.isPlaying) {
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
      } else {
        lastPositionRef.current = status.positionMillis;
      }
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

        if (!tracks.some((t) => t.name === file.name)) {
          const updated = [...tracks, newTrack];
          saveTracks(updated);
        }
      }
    } catch (e) {
      console.log('Fehler bei Dateiauswahl:', e);
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

      const existingNames = new Set(tracks.map((t) => t.name));
      const filteredNew = newTracks.filter((t) => !existingNames.has(t.name));
      const updated = [...tracks, ...filteredNew];

      saveTracks(updated);
      setLoading(false);
    } catch (e) {
      console.log('Ordner-Scan Fehler:', e);
      setLoading(false);
      Alert.alert('Hinweis', 'Ordner-Auswahl wird auf diesem Gerät nicht unterstützt.');
    }
  }

  // Song abspielen über Objekt oder Index
  async function playTrack(track) {
    const index = tracks.findIndex((t) => t.id === track.id || t.uri === track.uri);
    if (index !== -1) {
      playTrackByIndex(index);
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
    } else {
      await sound.playAsync();
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

  // Position mit Slider verändern
  async function onSlidingComplete(value) {
    if (sound) {
      await sound.setPositionAsync(value);
    }
    setIsSeeking(false);
  }

  function createPlaylist() {
    if (!newPlaylistName.trim()) return;
    const newPl = { id: Date.now().toString(), name: newPlaylistName.trim(), tracks: [] };
    const updated = [...playlists, newPl];
    savePlaylists(updated);
    setNewPlaylistName('');
  }

  function addTrackToPlaylist(track) {
    if (playlists.length === 0) {
      Alert.alert('AURA Player', 'Erstelle zuerst eine Playlist!');
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

  // Filterung nach Suche
  const filteredTracks = tracks.filter((item) => {
    const { artist, title } = parseSongName(item.name);
    const q = searchQuery.toLowerCase();
    return artist.toLowerCase().includes(q) || title.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
  });

  const sortedRanking = Object.keys(stats)
    .map((name) => ({ name, seconds: Math.floor(stats[name]) }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const currentTrack = currentTrackIndex !== null ? tracks[currentTrackIndex] : null;
  const currentParsed = currentTrack ? parseSongName(currentTrack.name) : null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#2d384e" />

      {/* Sauberer Header ohne Pfeile & Menüs */}
      <View style={styles.navBar}>
        <Text style={styles.navTitle}>AURA Player</Text>
        <TouchableOpacity style={styles.searchIconBtn} onPress={() => setShowSearch(!showSearch)}>
          <Text style={styles.searchIconText}>🔍</Text>
        </TouchableOpacity>
      </View>

      {/* Dynamische Suchleiste */}
      {showSearch && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Suchen nach Interpret oder Song..."
            placeholderTextColor="#8a95a5"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery !== '' && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
              <Text style={{ color: '#fff', fontSize: 12 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

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

      {/* Hauptliste */}
      <FlatList
        style={styles.mainList}
        data={filteredTracks}
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

                {/* Aufgeklappte Playlist-Inhalte mit Klick-zum-Abspielen */}
                {expandedPlaylistId === pl.id && (
                  <View style={styles.playlistContent}>
                    {pl.tracks && pl.tracks.length > 0 ? (
                      pl.tracks.map((t, i) => {
                        const parsed = parseSongName(t.name);
                        return (
                          <TouchableOpacity key={i} style={styles.playlistSubItem} onPress={() => playTrack(t)}>
                            <Text style={styles.playlistSubTitle} numberOfLines={1}>▶ {parsed.title}</Text>
                            <Text style={styles.playlistSubArtist} numberOfLines={1}>{parsed.artist}</Text>
                          </TouchableOpacity>
                        );
                      })
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
              sortedRanking.map((item, idx) => {
                const parsed = parseSongName(item.name);
                return (
                  <View key={idx} style={styles.rankRow}>
                    <Text style={styles.rankNum}>{idx + 1}.</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rankSongTitle} numberOfLines={1}>{parsed.title}</Text>
                      <Text style={styles.rankSongArtist} numberOfLines={1}>{parsed.artist}</Text>
                    </View>
                    <Text style={styles.rankTime}>{item.seconds} Sek.</Text>
                  </View>
                );
              })
            )}

            <Text style={styles.sectionTitle}>ALLE SONGS ({filteredTracks.length})</Text>
          </>
        )}
        renderItem={({ item, index }) => {
          const isSelected = currentTrackIndex === index;
          const { artist, title } = parseSongName(item.name);

          return (
            <View style={styles.songRow}>
              {/* Cover Icon */}
              <View style={styles.coverBox}>
                <Text style={{ fontSize: 18 }}>🎵</Text>
              </View>

              {/* Song & Interpret Getrennt */}
              <TouchableOpacity style={{ flex: 1 }} onPress={() => playTrackByIndex(index)}>
                <Text style={[styles.songTitle, isSelected && styles.activeSongTitle]} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={styles.songArtist} numberOfLines={1}>{artist}</Text>
              </TouchableOpacity>

              {/* Hinzufügen Button */}
              <TouchableOpacity style={styles.moreBtn} onPress={() => addTrackToPlaylist(item)}>
                <Text style={styles.moreBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {/* Untere Player-Steuerung mit Fortschritts-Leiste */}
      {currentTrack && (
        <View style={styles.bottomPlayer}>
          {/* Titel & Interpret Info */}
          <Text style={styles.nowPlayingTitle} numberOfLines={1}>
            {currentParsed ? currentParsed.title : currentTrack.name}
          </Text>
          <Text style={styles.nowPlayingArtist} numberOfLines={1}>
            {currentParsed ? currentParsed.artist : ''}
          </Text>

          {/* Horizontale Leiste (Seekbar) */}
          <View style={styles.progressContainer}>
            <Text style={styles.timeText}>{formatTime(positionMillis)}</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={durationMillis}
              value={positionMillis}
              minimumTrackTintColor="#ffd700"
              maximumTrackTintColor="rgba(255,255,255,0.2)"
              thumbTintColor="#ffd700"
              onValueChange={(val) => {
                setIsSeeking(true);
                setPositionMillis(val);
              }}
              onSlidingComplete={onSlidingComplete}
            />
            <Text style={styles.timeText}>{formatTime(durationMillis)}</Text>
          </View>

          {/* Tasten-Steuerung */}
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
  navTitle: { color: '#ffffff', fontSize: 22, fontWeight: 'bold' },
  searchIconBtn: { padding: 6 },
  searchIconText: { fontSize: 20 },

  searchContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, backgroundColor: '#1e2638', borderRadius: 8, paddingHorizontal: 10 },
  searchInput: { flex: 1, color: '#ffffff', height: 38, fontSize: 14 },
  clearSearchBtn: { padding: 6 },

  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 10 },
  actionBtn: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  actionBtnText: { color: '#ffffff', fontSize: 12, fontWeight: 'bold' },

  mainList: { flex: 1, paddingHorizontal: 16 },
  sectionTitle: { color: '#8a95a5', fontSize: 12, fontWeight: 'bold', marginTop: 15, marginBottom: 8, letterSpacing: 1 },

  songRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  coverBox: { width: 44, height: 44, backgroundColor: '#1e2638', borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  songTitle: { color: '#ffffff', fontSize: 15, fontWeight: '500', marginBottom: 2 },
  activeSongTitle: { color: '#ffd700', fontWeight: 'bold' },
  songArtist: { color: '#8a95a5', fontSize: 12 },
  moreBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4 },
  moreBtnText: { color: '#ffd700', fontSize: 16, fontWeight: 'bold' },

  playlistInputRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input: { flex: 1, backgroundColor: '#1e2638', borderRadius: 6, paddingHorizontal: 12, color: '#ffffff', fontSize: 13 },
  createBtn: { backgroundColor: '#ffd700', paddingHorizontal: 14, justifyContent: 'center', borderRadius: 6 },
  createBtnText: { color: '#1e2638', fontWeight: 'bold', fontSize: 13 },

  playlistBox: { backgroundColor: '#1e2638', borderRadius: 6, marginBottom: 6, padding: 10 },
  playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  playlistNameText: { color: '#ffffff', fontSize: 14, fontWeight: '500' },
  playlistContent: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  playlistSubItem: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)' },
  playlistSubTitle: { color: '#ffd700', fontSize: 13, fontWeight: 'bold' },
  playlistSubArtist: { color: '#8a95a5', fontSize: 11, marginLeft: 14 },

  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  rankNum: { color: '#ffd700', fontWeight: 'bold', width: 24 },
  rankSongTitle: { color: '#ffffff', fontSize: 13, fontWeight: '500' },
  rankSongArtist: { color: '#8a95a5', fontSize: 11 },
  rankTime: { color: '#ffd700', fontSize: 12, fontWeight: 'bold', marginLeft: 8 },

  // Player Leiste & Slider Style
  bottomPlayer: { backgroundColor: '#1e2638', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  nowPlayingTitle: { color: '#ffffff', fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  nowPlayingArtist: { color: '#8a95a5', fontSize: 12, textAlign: 'center', marginBottom: 4 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  slider: { flex: 1, height: 20, marginHorizontal: 6 },
  timeText: { color: '#8a95a5', fontSize: 10, width: 32, textAlign: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  cBtn: { padding: 6 },
  cText: { color: '#ffffff', fontSize: 18 },
  cBtnMain: { backgroundColor: '#ffd700', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  cTextMain: { color: '#1e2638', fontSize: 18, fontWeight: 'bold' },
});
