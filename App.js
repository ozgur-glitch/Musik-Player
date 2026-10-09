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
  ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';

const STORAGE_KEY_TRACKS = '@music_player_tracks';
const STORAGE_KEY_PLAYLISTS = '@music_player_playlists';
const STORAGE_KEY_STATS = '@music_player_stats';
const STORAGE_KEY_THEME = '@music_player_theme';

// Hilfsfunktion: Teilt "Interpret - Titel.mp3" sauber auf
function parseSongName(filename) {
  if (!filename) return { artist: 'Unbekannter Interpret', title: 'Unbekannter Titel' };
  const cleanName = filename.replace(/\.[^/.]+$/, '');
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

// Formatiert Sekunden in Sek, Min, Std (Punkt 4)
function formatListeningTime(seconds) {
  if (!seconds || seconds <= 0) return '0 Sek.';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs} Std. ${mins} Min.`;
  } else if (mins > 0) {
    return `${mins} Min. ${secs} Sek.`;
  }
  return `${secs} Sek.`;
}

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [stats, setStats] = useState({});
  const [isDarkMode, setIsDarkMode] = useState(true);

  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(null);
  const [activePlaylistId, setActivePlaylistId] = useState(null); // Modus: Bibliothek vs Playlist
  const [playlistTrackIndex, setPlaylistTrackIndex] = useState(null);
  const [loading, setLoading] = useState(false);

  // Suche & UI State
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showDevInfo, setShowDevInfo] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [expandedPlaylistId, setExpandedPlaylistId] = useState(null);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [editingPlaylistName, setEditingPlaylistName] = useState('');

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
      const savedTheme = await AsyncStorage.getItem(STORAGE_KEY_THEME);

      if (savedTracks) setTracks(JSON.parse(savedTracks));
      if (savedPlaylists) setPlaylists(JSON.parse(savedPlaylists));
      if (savedStats) setStats(JSON.parse(savedStats));
      if (savedTheme !== null) setIsDarkMode(JSON.parse(savedTheme));
    } catch (e) {
      console.log('Fehler beim Laden:', e);
    }
  }

  async function toggleTheme() {
    const nextMode = !isDarkMode;
    setIsDarkMode(nextMode);
    await AsyncStorage.setItem(STORAGE_KEY_THEME, JSON.stringify(nextMode));
  }

  async function saveTracks(newTracks) {
    setTracks(newTracks);
    await AsyncStorage.setItem(STORAGE_KEY_TRACKS, JSON.stringify(newTracks));
  }

  async function savePlaylists(newPlaylists) {
    setPlaylists(newPlaylists);
    await AsyncStorage.setItem(STORAGE_KEY_PLAYLISTS, JSON.stringify(newPlaylists));
  }

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

  // Rekursives Ordner-Scannen für Unterordner (Punkt 5)
  async function scanDirectoryRecursive(directoryUri) {
    let mp3s = [];
    try {
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(directoryUri);
      for (const uri of files) {
        if (uri.endsWith('.mp3') || uri.includes('.mp3')) {
          const decoded = decodeURIComponent(uri);
          const name = decoded.substring(decoded.lastIndexOf('/') + 1);
          mp3s.push({ id: `${Date.now()}_${Math.random()}`, name, uri });
        } else if (!uri.includes('.')) {
          // Versuche Unterordner zu lesen
          try {
            const subMp3s = await scanDirectoryRecursive(uri);
            mp3s = mp3s.concat(subMp3s);
          } catch (err) {
            // Ignoriere Dateien/Ordner ohne Zugriff
          }
        }
      }
    } catch (e) {
      console.log('Subdir scan error:', e);
    }
    return mp3s;
  }

  async function pickFolder() {
    try {
      const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!permissions.granted) return;

      setLoading(true);
      const newTracks = await scanDirectoryRecursive(permissions.directoryUri);

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

  // Song abspielen aus der Bibliothek
  async function playTrackFromLibrary(index) {
    if (index < 0 || index >= tracks.length) return;
    setActivePlaylistId(null);
    setPlaylistTrackIndex(null);
    setCurrentTrackIndex(index);
    playAudio(tracks[index]);
  }

  // Song abspielen aus einer Playlist (Punkt 1 & 2)
  async function playTrackFromPlaylist(playlistId, trackIndex) {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl || !pl.tracks || trackIndex < 0 || trackIndex >= pl.tracks.length) return;

    setActivePlaylistId(playlistId);
    setPlaylistTrackIndex(trackIndex);
    setCurrentTrackIndex(null);
    playAudio(pl.tracks[trackIndex]);
  }

  async function playAudio(track) {
    try {
      setLoading(true);
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

  // Playlist-isoliertes Vor/Zurück (Punkt 2)
  function playNextTrack() {
    if (activePlaylistId) {
      const pl = playlists.find((p) => p.id === activePlaylistId);
      if (pl && playlistTrackIndex !== null && playlistTrackIndex < pl.tracks.length - 1) {
        playTrackFromPlaylist(activePlaylistId, playlistTrackIndex + 1);
      }
    } else if (currentTrackIndex !== null && currentTrackIndex < tracks.length - 1) {
      playTrackFromLibrary(currentTrackIndex + 1);
    }
  }

  function playPreviousTrack() {
    if (activePlaylistId) {
      const pl = playlists.find((p) => p.id === activePlaylistId);
      if (pl && playlistTrackIndex !== null && playlistTrackIndex > 0) {
        playTrackFromPlaylist(activePlaylistId, playlistTrackIndex - 1);
      }
    } else if (currentTrackIndex !== null && currentTrackIndex > 0) {
      playTrackFromLibrary(currentTrackIndex - 1);
    }
  }

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
      Alert.alert('Musik Player', 'Erstelle zuerst eine Playlist!');
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

  // Playlist Umbenennen (Punkt 10)
  function savePlaylistName(playlistId) {
    if (!editingPlaylistName.trim()) return;
    const updated = playlists.map((p) => {
      if (p.id === playlistId) {
        return { ...p, name: editingPlaylistName.trim() };
      }
      return p;
    });
    savePlaylists(updated);
    setEditingPlaylistId(null);
  }

  // Song aus Playlist löschen (Punkt 9)
  function removeTrackFromPlaylist(playlistId, trackIndex) {
    const updated = playlists.map((p) => {
      if (p.id === playlistId) {
        const newTracksList = [...p.tracks];
        newTracksList.splice(trackIndex, 1);
        return { ...p, tracks: newTracksList };
      }
      return p;
    });
    savePlaylists(updated);
  }

  // Reihenfolge in Playlist ändern (Punkt 9)
  function moveTrackInPlaylist(playlistId, fromIndex, direction) {
    const toIndex = fromIndex + direction;
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl || toIndex < 0 || toIndex >= pl.tracks.length) return;

    const updatedTracks = [...pl.tracks];
    const [movedTrack] = updatedTracks.splice(fromIndex, 1);
    updatedTracks.splice(toIndex, 0, movedTrack);

    const updatedPlaylists = playlists.map((p) => (p.id === playlistId ? { ...p, tracks: updatedTracks } : p));
    savePlaylists(updatedPlaylists);
  }

  const filteredTracks = tracks.filter((item) => {
    const { artist, title } = parseSongName(item.name);
    const q = searchQuery.toLowerCase();
    return artist.toLowerCase().includes(q) || title.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
  });

  const sortedRanking = Object.keys(stats)
    .map((name) => ({ name, seconds: Math.floor(stats[name]) }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  // Aktueller Track ermitteln
  let currentTrack = null;
  if (activePlaylistId) {
    const pl = playlists.find((p) => p.id === activePlaylistId);
    if (pl && pl.tracks && playlistTrackIndex !== null) {
      currentTrack = pl.tracks[playlistTrackIndex];
    }
  } else if (currentTrackIndex !== null) {
    currentTrack = tracks[currentTrackIndex];
  }

  const currentParsed = currentTrack ? parseSongName(currentTrack.name) : null;

  // Dynamische Theme Styles (Punkt 8)
  const theme = isDarkMode ? darkStyles : lightStyles;

  return (
    <View style={[styles.container, theme.bg]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={isDarkMode ? '#2d384e' : '#f0f4f8'} />

      {/* Header */}
      <View style={[styles.navBar, theme.nav]}>
        <Text style={[styles.navTitle, theme.text]}>Musik Player</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={() => setShowDevInfo(!showDevInfo)}>
            <Text style={{ fontSize: 18 }}>ℹ️</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleTheme}>
            <Text style={{ fontSize: 18 }}>{isDarkMode ? '☀️' : '🌙'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowSearch(!showSearch)}>
            <Text style={{ fontSize: 18 }}>🔍</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Entwickler Info Modal (Punkt 7) */}
      {showDevInfo && (
        <View style={[styles.devBox, theme.card]}>
          <Text style={[styles.devTitle, theme.text]}>Entwickler-Information</Text>
          <Text style={[styles.devText, theme.subText]}>👨‍💻 Entwickler: Özgür Cetin</Text>
          <Text style={[styles.devText, theme.subText]}>✉️ E-Mail: ozgur.cetin@web.de</Text>
        </View>
      )}

      {/* Suchleiste */}
      {showSearch && (
        <View style={[styles.searchContainer, theme.card]}>
          <TextInput
            style={[styles.searchInput, theme.text]}
            placeholder="Suchen nach Interpret oder Song..."
            placeholderTextColor="#8a95a5"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery !== '' && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={{ color: theme.subText.color }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Import Action Buttons */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={pickSingleTrack}>
          <Text style={styles.actionBtnText}>+ DATEI</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={pickFolder}>
          <Text style={styles.actionBtnText}>+ ORDNER</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="small" color="#ffd700" style={{ marginVertical: 4 }} />}

      <ScrollView style={styles.mainScroll} keyboardShouldPersistTaps="handled">
        {/* Playlists Bereich */}
        <Text style={[styles.sectionTitle, theme.subText]}>PLAYLISTS ({playlists.length})</Text>
        
        {/* Playlist Erstellen Formular (Punkt 1 Gefixt) */}
        <View style={styles.playlistInputRow}>
          <TextInput
            style={[styles.input, theme.card, theme.text]}
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
          <View key={pl.id} style={[styles.playlistBox, theme.card]}>
            <View style={styles.playlistHeader}>
              {editingPlaylistId === pl.id ? (
                <View style={{ flexDirection: 'row', flex: 1, gap: 6 }}>
                  <TextInput
                    style={[styles.input, theme.text, { flex: 1, height: 32 }]}
                    value={editingPlaylistName}
                    onChangeText={setEditingPlaylistName}
                  />
                  <TouchableOpacity style={styles.miniSaveBtn} onPress={() => savePlaylistName(pl.id)}>
                    <Text style={{ color: '#1e2638', fontWeight: 'bold', fontSize: 11 }}>OK</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  onPress={() => setExpandedPlaylistId(expandedPlaylistId === pl.id ? null : pl.id)}
                >
                  <Text style={[styles.playlistNameText, theme.text]}>
                    📜 {pl.name} ({pl.tracks ? pl.tracks.length : 0} Songs)
                  </Text>
                  <TouchableOpacity onPress={() => { setEditingPlaylistId(pl.id); setEditingPlaylistName(pl.name); }}>
                    <Text style={{ fontSize: 12 }}>✏️</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => setExpandedPlaylistId(expandedPlaylistId === pl.id ? null : pl.id)}>
                <Text style={{ color: '#8a95a5' }}>{expandedPlaylistId === pl.id ? '▲' : '▼'}</Text>
              </TouchableOpacity>
            </View>

            {/* Aufgeklappte Playlist-Inhalte mit Editierfunktion (Punkt 9 & 10) */}
            {expandedPlaylistId === pl.id && (
              <View style={styles.playlistContent}>
                {pl.tracks && pl.tracks.length > 0 ? (
                  pl.tracks.map((t, idx) => {
                    const parsed = parseSongName(t.name);
                    return (
                      <View key={idx} style={styles.playlistSubItem}>
                        <TouchableOpacity style={{ flex: 1 }} onPress={() => playTrackFromPlaylist(pl.id, idx)}>
                          <Text style={styles.playlistSubTitle} numberOfLines={1}>▶ {parsed.title}</Text>
                          <Text style={styles.playlistSubArtist} numberOfLines={1}>{parsed.artist}</Text>
                        </TouchableOpacity>

                        {/* Verschieben & Löschen Buttons */}
                        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                          <TouchableOpacity onPress={() => moveTrackInPlaylist(pl.id, idx, -1)}>
                            <Text style={{ fontSize: 12, color: theme.text.color }}>▲</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => moveTrackInPlaylist(pl.id, idx, 1)}>
                            <Text style={{ fontSize: 12, color: theme.text.color }}>▼</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => removeTrackFromPlaylist(pl.id, idx)}>
                            <Text style={{ fontSize: 12, color: '#ff4d4d', marginLeft: 4 }}>❌</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
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

        {/* Separate Ranglisten-Tabelle (Punkt 3 & 4) */}
        <Text style={[styles.sectionTitle, theme.subText]}>🏆 RANGLISTE (HÖRZEIT)</Text>
        <View style={[styles.tableBox, theme.card]}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, { width: 30 }, theme.subText]}>#</Text>
            <Text style={[styles.th, { flex: 1 }, theme.subText]}>Titel / Interpret</Text>
            <Text style={[styles.th, { width: 100, textAlign: 'right' }, theme.subText]}>Hörzeit</Text>
          </View>
          {sortedRanking.length === 0 ? (
            <Text style={{ color: '#8a95a5', fontSize: 12, padding: 10, textAlign: 'center' }}>
              Noch keine Daten vorhanden
            </Text>
          ) : (
            sortedRanking.map((item, idx) => {
              const parsed = parseSongName(item.name);
              return (
                <View key={idx} style={styles.tableRow}>
                  <Text style={[styles.tdRank, { width: 30 }]}>{idx + 1}.</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.tdTitle, theme.text]} numberOfLines={1}>{parsed.title}</Text>
                    <Text style={[styles.tdArtist, theme.subText]} numberOfLines={1}>{parsed.artist}</Text>
                  </View>
                  <Text style={[styles.tdTime, { width: 100 }]}>
                    {formatListeningTime(item.seconds)}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {/* Alle Songs / Bibliothek */}
        <Text style={[styles.sectionTitle, theme.subText]}>ALLE SONGS ({filteredTracks.length})</Text>
        {filteredTracks.map((item, index) => {
          const isSelected = !activePlaylistId && currentTrackIndex === index;
          const { artist, title } = parseSongName(item.name);

          return (
            <View key={item.id || index} style={[styles.songRow, theme.border]}>
              <View style={[styles.coverBox, theme.card]}>
                <Text style={{ fontSize: 18 }}>🎵</Text>
              </View>

              <TouchableOpacity style={{ flex: 1 }} onPress={() => playTrackFromLibrary(index)}>
                <Text style={[styles.songTitle, theme.text, isSelected && styles.activeSongTitle]} numberOfLines={1}>
                  {title}
                </Text>
                <Text style={[styles.songArtist, theme.subText]} numberOfLines={1}>{artist}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.moreBtn} onPress={() => addTrackToPlaylist(item)}>
                <Text style={styles.moreBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Unterer Player */}
      {currentTrack && (
        <View style={[styles.bottomPlayer, theme.nav]}>
          <Text style={[styles.nowPlayingTitle, theme.text]} numberOfLines={1}>
            {currentParsed ? currentParsed.title : currentTrack.name}
          </Text>
          <Text style={styles.nowPlayingArtist} numberOfLines={1}>
            {currentParsed ? currentParsed.artist : ''}
          </Text>

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

          <View style={styles.controls}>
            <TouchableOpacity onPress={playPreviousTrack} style={styles.cBtn}>
              <Text style={[styles.cText, theme.text]}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={styles.cBtnMain}>
              <Text style={styles.cTextMain}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={stopAudio} style={styles.cBtn}>
              <Text style={[styles.cText, theme.text]}>⏹</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={playNextTrack} style={styles.cBtn}>
              <Text style={[styles.cText, theme.text]}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const darkStyles = {
  bg: { backgroundColor: '#2d384e' },
  nav: { backgroundColor: '#1e2638' },
  card: { backgroundColor: '#1e2638' },
  text: { color: '#ffffff' },
  subText: { color: '#8a95a5' },
  border: { borderBottomColor: 'rgba(255,255,255,0.05)' },
};

const lightStyles = {
  bg: { backgroundColor: '#f0f4f8' },
  nav: { backgroundColor: '#ffffff' },
  card: { backgroundColor: '#ffffff' },
  text: { color: '#1a202c' },
  subText: { color: '#718096' },
  border: { borderBottomColor: 'rgba(0,0,0,0.05)' },
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 35 },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  navTitle: { fontSize: 20, fontWeight: 'bold' },

  devBox: { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 8 },
  devTitle: { fontWeight: 'bold', fontSize: 13, marginBottom: 4 },
  devText: { fontSize: 12 },

  searchContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, borderRadius: 8, paddingHorizontal: 10 },
  searchInput: { flex: 1, height: 38, fontSize: 14 },

  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 10, marginBottom: 10 },
  actionBtn: { flex: 1, backgroundColor: '#ffd700', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  actionBtnText: { color: '#1e2638', fontSize: 12, fontWeight: 'bold' },

  mainScroll: { flex: 1, paddingHorizontal: 16 },
  sectionTitle: { fontSize: 11, fontWeight: 'bold', marginTop: 14, marginBottom: 6, letterSpacing: 1 },

  playlistInputRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input: { flex: 1, borderRadius: 6, paddingHorizontal: 12, height: 38, fontSize: 13 },
  createBtn: { backgroundColor: '#ffd700', paddingHorizontal: 14, justifyContent: 'center', borderRadius: 6 },
  createBtnText: { color: '#1e2638', fontWeight: 'bold', fontSize: 13 },

  playlistBox: { borderRadius: 6, marginBottom: 6, padding: 10 },
  playlistHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  playlistNameText: { fontSize: 14, fontWeight: '500' },
  playlistContent: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  playlistSubItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)' },
  playlistSubTitle: { color: '#ffd700', fontSize: 13, fontWeight: 'bold' },
  playlistSubArtist: { color: '#8a95a5', fontSize: 11, marginLeft: 14 },
  miniSaveBtn: { backgroundColor: '#ffd700', paddingHorizontal: 8, justifyContent: 'center', borderRadius: 4 },

  // Table Styles (Punkt 3)
  tableBox: { borderRadius: 6, padding: 10, marginBottom: 10 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', paddingBottom: 6, marginBottom: 6 },
  th: { fontSize: 11, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)' },
  tdRank: { color: '#ffd700', fontWeight: 'bold', fontSize: 12 },
  tdTitle: { fontSize: 13, fontWeight: '500' },
  tdArtist: { fontSize: 11 },
  tdTime: { color: '#ffd700', fontSize: 11, fontWeight: 'bold', textAlign: 'right' },

  songRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  coverBox: { width: 42, height: 42, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  songTitle: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  activeSongTitle: { color: '#ffd700', fontWeight: 'bold' },
  songArtist: { fontSize: 12 },
  moreBtn: { paddingHorizontal: 12, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 4 },
  moreBtnText: { color: '#ffd700', fontSize: 16, fontWeight: 'bold' },

  bottomPlayer: { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  nowPlayingTitle: { fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  nowPlayingArtist: { color: '#8a95a5', fontSize: 12, textAlign: 'center', marginBottom: 4 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  slider: { flex: 1, height: 20, marginHorizontal: 6 },
  timeText: { color: '#8a95a5', fontSize: 10, width: 32, textAlign: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  cBtn: { padding: 6 },
  cText: { fontSize: 18 },
  cBtnMain: { backgroundColor: '#ffd700', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  cTextMain: { color: '#1e2638', fontSize: 18, fontWeight: 'bold' },
});
