import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  StatusBar,
  ScrollView,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';

const STORAGE_KEY_TRACKS = '@music_player_tracks';
const STORAGE_KEY_PLAYLISTS = '@music_player_playlists';
const STORAGE_KEY_STATS = '@music_player_stats';
const STORAGE_KEY_THEME = '@music_player_theme';

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

function formatTime(millis) {
  if (!millis || isNaN(millis)) return '0:00';
  const totalSeconds = Math.floor(millis / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function formatListeningTime(seconds) {
  if (!seconds || seconds <= 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const paddedHrs = hrs < 10 ? `0${hrs}` : `${hrs}`;
  const paddedMins = mins < 10 ? `0${mins}` : `${mins}`;
  const paddedSecs = secs < 10 ? `0${secs}` : `${secs}`;

  return `${paddedHrs}:${paddedMins}:${paddedSecs}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('library');
  const [rankingSubTab, setRankingSubTab] = useState('songs');
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [stats, setStats] = useState({});
  const [isDarkMode, setIsDarkMode] = useState(true);

  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(null);
  const [activePlaylistId, setActivePlaylistId] = useState(null);
  const [playlistTrackIndex, setPlaylistTrackIndex] = useState(null);
  const [loading, setLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showDevInfo, setShowDevInfo] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [expandedPlaylistId, setExpandedPlaylistId] = useState(null);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [editingPlaylistName, setEditingPlaylistName] = useState('');
  
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState(null);

  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(1);
  const [isSeeking, setIsSeeking] = useState(false);

  const lastPositionRef = useRef(0);
  const currentSongNameRef = useRef('');

  useEffect(() => {
    loadSavedData();
    setupAudioMode();
    requestPermissions();
  }, []);

  async function requestPermissions() {
    try {
      await MediaLibrary.requestPermissionsAsync();

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
    } catch (e) {
      console.log('Permission Error:', e);
    }
  }

  async function setupAudioMode() {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    } catch (e) {
      console.log('Audio Mode Fehler:', e);
    }
  }

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

  async function scanDeviceMusic() {
    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Berechtigung erforderlich', 'Bitte erlaube den Zugriff auf die Medienbibliothek.');
        return;
      }

      setLoading(true);
      const media = await MediaLibrary.getAssetsAsync({
        mediaType: MediaLibrary.MediaType.audio,
        first: 1000,
      });

      if (media && media.assets) {
        const existingNames = new Set(tracks.map((t) => t.name));
        const newTracks = media.assets
          .filter((asset) => !existingNames.has(asset.filename))
          .map((asset) => ({
            id: asset.id,
            name: asset.filename,
            uri: asset.uri,
          }));

        const updated = [...tracks, ...newTracks];
        saveTracks(updated);
        setLoading(false);
        Alert.alert('Erfolg', `${newTracks.length} neue Songs vom Gerät hinzugefügt.`);
      } else {
        setLoading(false);
        Alert.alert('Hinweis', 'Keine Musikdateien gefunden.');
      }
    } catch (e) {
      console.log('MediaLibrary Scan Fehler:', e);
      setLoading(false);
      Alert.alert('Fehler', 'Mediensuche fehlgeschlagen.');
    }
  }

  async function playTrackFromLibrary(index) {
    if (index < 0 || index >= tracks.length) return;
    setActivePlaylistId(null);
    setPlaylistTrackIndex(null);
    setCurrentTrackIndex(index);
    playAudio(tracks[index]);
  }

  async function playTrackDirect(track) {
    const idx = tracks.findIndex((t) => t.name === track.name || t.id === track.id);
    if (idx !== -1) {
      playTrackFromLibrary(idx);
    } else {
      setActivePlaylistId(null);
      setPlaylistTrackIndex(null);
      setCurrentTrackIndex(null);
      playAudio(track);
    }
  }

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

      await setupAudioMode();

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

  // Playlist löschen Funktion
  function deletePlaylist(playlistId, playlistName) {
    Alert.alert(
      'Playlist löschen',
      `Möchtest du die Playlist "${playlistName}" wirklich löschen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: () => {
            const updated = playlists.filter((p) => p.id !== playlistId);
            savePlaylists(updated);
            if (activePlaylistId === playlistId) {
              setActivePlaylistId(null);
            }
          },
        },
      ]
    );
  }

  // Rangliste sichern (Exportieren als JSON-Datei)
  async function backupRanking() {
    try {
      if (Object.keys(stats).length === 0) {
        Alert.alert('Hinweis', 'Es sind keine Ranglisten-Daten zum Sichern vorhanden.');
        return;
      }
      const fileUri = `${FileSystem.documentDirectory}musik_player_ranking_backup.json`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(stats, null, 2));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Erfolg', 'Rangliste wurde gesichert.');
      }
    } catch (e) {
      console.log('Backup Fehler:', e);
      Alert.alert('Fehler', 'Rangliste konnte nicht gesichert werden.');
    }
  }

  // Rangliste wiederherstellen (Importieren aus JSON-Datei)
  async function restoreRanking() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const fileUri = result.assets[0].uri;
        const fileContent = await FileSystem.readAsStringAsync(fileUri);
        const parsedStats = JSON.parse(fileContent);

        setStats(parsedStats);
        await AsyncStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(parsedStats));
        Alert.alert('Erfolg', 'Rangliste wurde erfolgreich wiederhergestellt!');
      }
    } catch (e) {
      console.log('Restore Fehler:', e);
      Alert.alert('Fehler', 'Ungültige Backup-Datei.');
    }
  }

  function addTrackToPlaylist(track) {
    if (playlists.length === 0) {
      Alert.alert('Musik Player', 'Erstelle zuerst eine Playlist!');
      return;
    }
    setTrackToAddToPlaylist(track);
  }

  function confirmAddTrackToPlaylist(playlistId) {
    if (!trackToAddToPlaylist) return;
    const updated = playlists.map((p) => {
      if (p.id === playlistId) {
        const alreadyExists = p.tracks.some((t) => t.id === trackToAddToPlaylist.id);
        if (alreadyExists) return p;
        return { ...p, tracks: [...p.tracks, trackToAddToPlaylist] };
      }
      return p;
    });
    savePlaylists(updated);
    setTrackToAddToPlaylist(null);
  }

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

  const sortedSongRanking = Object.keys(stats)
    .map((name) => {
      const foundTrack = tracks.find((t) => t.name === name);
      return {
        name,
        track: foundTrack || { name },
        seconds: Math.floor(stats[name]),
      };
    })
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const artistStats = {};
  Object.keys(stats).forEach((songName) => {
    const { artist } = parseSongName(songName);
    const sec = stats[songName] || 0;
    artistStats[artist] = (artistStats[artist] || 0) + sec;
  });

  const sortedArtistRanking = Object.keys(artistStats)
    .map((artist) => ({
      artist,
      seconds: Math.floor(artistStats[artist]),
    }))
    .filter((item) => item.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

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

      {/* Haupt-Tab Navigation */}
      <View style={[styles.tabBar, theme.nav]}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'library' && styles.activeTabItem]}
          onPress={() => setActiveTab('library')}
        >
          <Text style={[styles.tabText, activeTab === 'library' ? styles.activeTabText : theme.subText]}>
            🎵 Bibliothek
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'ranking' && styles.activeTabItem]}
          onPress={() => setActiveTab('ranking')}
        >
          <Text style={[styles.tabText, activeTab === 'ranking' ? styles.activeTabText : theme.subText]}>
            🏆 Rangliste
          </Text>
        </TouchableOpacity>
      </View>

      {/* Entwickler Info */}
      {showDevInfo && (
        <View style={[styles.devBox, theme.card]}>
          <Text style={[styles.devTitle, theme.text]}>Entwickler-Information</Text>
          <Text style={[styles.devText, theme.subText]}>👨‍💻 Entwickler: Özgür Cetin</Text>
          <Text style={[styles.devText, theme.subText]}>✉️ E-Mail: ozgur.cetin@web.de</Text>
        </View>
      )}

      {/* Suche */}
      {showSearch && (
        <View style={[styles.searchContainer, theme.card]}>
          <TextInput
            style={[styles.searchInput, theme.text]}
            placeholder="Suchen..."
            placeholderTextColor={theme.subText.color}
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

      <ScrollView style={styles.mainScroll} keyboardShouldPersistTaps="handled">
        {/* TAB 1: BIBLIOTHEK */}
        {activeTab === 'library' && (
          <>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={pickSingleTrack}>
                <Text style={styles.actionBtnText}>+ DATEI</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={scanDeviceMusic}>
                <Text style={styles.actionBtnText}>+ ALLE SONGS (GERÄT)</Text>
              </TouchableOpacity>
            </View>

            {loading && <ActivityIndicator size="small" color="#ffd700" style={{ marginVertical: 4 }} />}

            <Text style={[styles.sectionTitle, theme.subText]}>PLAYLISTS ({playlists.length})</Text>
            <View style={styles.playlistInputRow}>
              <TextInput
                style={[styles.input, theme.card, theme.text]}
                placeholder="Neue Playlist Name..."
                placeholderTextColor={theme.subText.color}
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
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => { setEditingPlaylistId(pl.id); setEditingPlaylistName(pl.name); }}>
                          <Text style={{ fontSize: 12 }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => deletePlaylist(pl.id, pl.name)}>
                          <Text style={{ fontSize: 12 }}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => setExpandedPlaylistId(expandedPlaylistId === pl.id ? null : pl.id)}>
                    <Text style={{ color: theme.subText.color }}>{expandedPlaylistId === pl.id ? '▲' : '▼'}</Text>
                  </TouchableOpacity>
                </View>

                {expandedPlaylistId === pl.id && (
                  <View style={styles.playlistContent}>
                    {pl.tracks && pl.tracks.length > 0 ? (
                      pl.tracks.map((t, idx) => {
                        const parsed = parseSongName(t.name);
                        return (
                          <View key={idx} style={styles.playlistSubItem}>
                            <TouchableOpacity style={{ flex: 1 }} onPress={() => playTrackFromPlaylist(pl.id, idx)}>
                              <Text style={styles.playlistSubTitle} numberOfLines={1}>▶ {parsed.title}</Text>
                              <Text style={[styles.playlistSubArtist, theme.subText]} numberOfLines={1}>{parsed.artist}</Text>
                            </TouchableOpacity>

                            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
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
                      <Text style={{ color: theme.subText.color, fontSize: 12, paddingVertical: 4 }}>
                        Keine Songs in dieser Playlist
                      </Text>
                    )}
                  </View>
                )}
              </View>
            ))}

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
          </>
        )}

        {/* TAB 2: RANGLISTE */}
        {activeTab === 'ranking' && (
          <View style={{ marginTop: 10 }}>
            {/* Backup & Restore Action Row */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <TouchableOpacity style={styles.backupBtn} onPress={backupRanking}>
                <Text style={styles.backupBtnText}>📤 Rangliste sichern</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.backupBtn} onPress={restoreRanking}>
                <Text style={styles.backupBtnText}>📥 Wiederherstellen</Text>
              </TouchableOpacity>
            </View>

            {/* Unter-Kategorie Tabs */}
            <View style={styles.subTabBar}>
              <TouchableOpacity
                style={[styles.subTabBtn, rankingSubTab === 'songs' && styles.activeSubTabBtn]}
                onPress={() => setRankingSubTab('songs')}
              >
                <Text style={[styles.subTabText, rankingSubTab === 'songs' ? styles.activeSubTabText : theme.subText]}>
                  🎵 Meistgehörte Titel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.subTabBtn, rankingSubTab === 'artists' && styles.activeSubTabBtn]}
                onPress={() => setRankingSubTab('artists')}
              >
                <Text style={[styles.subTabText, rankingSubTab === 'artists' ? styles.activeSubTabText : theme.subText]}>
                  👤 Meistgehörte Interpreten
                </Text>
              </TouchableOpacity>
            </View>

            {/* TABELLE: MEISTGEHÖRTE TITEL */}
            {rankingSubTab === 'songs' && (
              <View style={[styles.tableBox, theme.card]}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { width: 30 }, theme.subText]}>#</Text>
                  <Text style={[styles.th, { flex: 1 }, theme.subText]}>Titel & Interpret</Text>
                  <Text style={[styles.th, { width: 90, textAlign: 'right' }, theme.subText]}>Hörzeit</Text>
                </View>

                {sortedSongRanking.length === 0 ? (
                  <Text style={{ color: theme.subText.color, fontSize: 13, padding: 15, textAlign: 'center' }}>
                    Noch keine Wiedergabedaten vorhanden.
                  </Text>
                ) : (
                  sortedSongRanking.map((item, idx) => {
                    const parsed = parseSongName(item.name);
                    return (
                      <TouchableOpacity
                        key={idx}
                        style={styles.tableRow}
                        onPress={() => playTrackDirect(item.track)}
                      >
                        <Text style={[styles.tdRank, { width: 30 }]}>{idx + 1}.</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.tdTitle, theme.text]} numberOfLines={1}>▶ {parsed.title}</Text>
                          <Text style={[styles.tdArtist, theme.subText]} numberOfLines={1}>{parsed.artist}</Text>
                        </View>
                        <Text style={[styles.tdTime, { width: 90 }]}>
                          {formatListeningTime(item.seconds)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}

            {/* TABELLE: MEISTGEHÖRTE INTERPRETEN */}
            {rankingSubTab === 'artists' && (
              <View style={[styles.tableBox, theme.card]}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { width: 30 }, theme.subText]}>#</Text>
                  <Text style={[styles.th, { flex: 1 }, theme.subText]}>Interpret</Text>
                  <Text style={[styles.th, { width: 90, textAlign: 'right' }, theme.subText]}>Hörzeit</Text>
                </View>

                {sortedArtistRanking.length === 0 ? (
                  <Text style={{ color: theme.subText.color, fontSize: 13, padding: 15, textAlign: 'center' }}>
                    Noch keine Wiedergabedaten vorhanden.
                  </Text>
                ) : (
                  sortedArtistRanking.map((item, idx) => (
                    <View key={idx} style={styles.tableRow}>
                      <Text style={[styles.tdRank, { width: 30 }]}>{idx + 1}.</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.tdTitle, theme.text]} numberOfLines={1}>👤 {item.artist}</Text>
                      </View>
                      <Text style={[styles.tdTime, { width: 90 }]}>
                        {formatListeningTime(item.seconds)}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Unterer Player mit modernen & professionellen Buttons */}
      {currentTrack && (
        <View style={[styles.bottomPlayer, theme.nav]}>
          <Text style={[styles.nowPlayingTitle, theme.text]} numberOfLines={1}>
            {currentParsed ? currentParsed.title : currentTrack.name}
          </Text>
          <Text style={[styles.nowPlayingArtist, theme.subText]} numberOfLines={1}>
            {currentParsed ? currentParsed.artist : ''}
          </Text>

          <View style={styles.progressContainer}>
            <Text style={[styles.timeText, theme.subText]}>{formatTime(positionMillis)}</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={durationMillis}
              value={positionMillis}
              minimumTrackTintColor="#ffd700"
              maximumTrackTintColor={isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}
              thumbTintColor="#ffd700"
              onValueChange={(val) => {
                setIsSeeking(true);
                setPositionMillis(val);
              }}
              onSlidingComplete={onSlidingComplete}
            />
            <Text style={[styles.timeText, theme.subText]}>{formatTime(durationMillis)}</Text>
          </View>

          <View style={styles.controls}>
            <TouchableOpacity onPress={playPreviousTrack} style={styles.modernBtn}>
              <Text style={styles.modernBtnText}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={togglePlayPause} style={styles.modernBtnMain}>
              <Text style={styles.modernBtnMainText}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={stopAudio} style={styles.modernBtn}>
              <Text style={styles.modernBtnText}>⏹</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={playNextTrack} style={styles.modernBtn}>
              <Text style={styles.modernBtnText}>⏭</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* MODAL / OVERLAY FÜR ALLE PLAYLISTS ZUM HINZUFÜGEN */}
      {trackToAddToPlaylist && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, theme.card]}>
            <Text style={[styles.modalTitle, theme.text]}>Zu Playlist hinzufügen</Text>
            <Text style={[styles.modalSubTitle, theme.subText]} numberOfLines={1}>
              {trackToAddToPlaylist.name}
            </Text>

            <ScrollView style={{ maxHeight: 260, marginVertical: 8 }}>
              {playlists.map((pl) => (
                <TouchableOpacity
                  key={pl.id}
                  style={[styles.modalItem, theme.border]}
                  onPress={() => confirmAddTrackToPlaylist(pl.id)}
                >
                  <Text style={[styles.modalItemText, theme.text]}>
                    📜 {pl.name} ({pl.tracks ? pl.tracks.length : 0} Songs)
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setTrackToAddToPlaylist(null)}
            >
              <Text style={styles.modalCancelText}>Abbrechen</Text>
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
  subText: { color: '#4a5568' },
  border: { borderBottomColor: 'rgba(0,0,0,0.08)' },
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 35 },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  navTitle: { fontSize: 20, fontWeight: 'bold' },

  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  tabItem: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  activeTabItem: { borderBottomWidth: 3, borderBottomColor: '#ffd700' },
  tabText: { fontSize: 13, fontWeight: 'bold' },
  activeTabText: { color: '#ffd700' },

  subTabBar: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  subTabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.05)' },
  activeSubTabBtn: { backgroundColor: '#ffd700' },
  subTabText: { fontSize: 11, fontWeight: 'bold' },
  activeSubTabText: { color: '#1e2638' },

  backupBtn: { flex: 1, backgroundColor: 'rgba(255,215,0,0.15)', borderWidth: 1, borderColor: '#ffd700', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  backupBtnText: { color: '#ffd700', fontSize: 12, fontWeight: 'bold' },

  devBox: { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 8 },
  devTitle: { fontWeight: 'bold', fontSize: 13, marginBottom: 4 },
  devText: { fontSize: 12 },

  searchContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 8, borderRadius: 8, paddingHorizontal: 10 },
  searchInput: { flex: 1, height: 38, fontSize: 14 },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 10 },
  actionBtn: { flex: 1, backgroundColor: '#ffd700', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  actionBtnText: { color: '#1e2638', fontSize: 11, fontWeight: 'bold' },

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
  playlistSubItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.03)' },
  playlistSubTitle: { color: '#ffd700', fontSize: 13, fontWeight: 'bold' },
  playlistSubArtist: { fontSize: 11, marginLeft: 14 },
  miniSaveBtn: { backgroundColor: '#ffd700', paddingHorizontal: 8, justifyContent: 'center', borderRadius: 4 },

  tableBox: { borderRadius: 8, padding: 12, marginBottom: 15 },
  tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)', paddingBottom: 8, marginBottom: 6 },
  th: { fontSize: 11, fontWeight: 'bold' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.03)' },
  tdRank: { color: '#ffd700', fontWeight: 'bold', fontSize: 13 },
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

  bottomPlayer: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.1)' },
  nowPlayingTitle: { fontSize: 14, fontWeight: 'bold', textAlign: 'center' },
  nowPlayingArtist: { fontSize: 12, textAlign: 'center', marginBottom: 6 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  slider: { flex: 1, height: 20, marginHorizontal: 6 },
  timeText: { fontSize: 10, width: 32, textAlign: 'center' },
  
  // Professionelles modernes Button-Design
  controls: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16 },
  modernBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  modernBtnText: { fontSize: 16, color: '#ffd700' },
  modernBtnMain: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#ffd700', justifyContent: 'center', alignItems: 'center', shadowColor: '#ffd700', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 },
  modernBtnMainText: { fontSize: 20, color: '#1e2638', fontWeight: 'bold', marginLeft: 2 },

  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  modalBox: { width: '85%', borderRadius: 12, padding: 20, elevation: 5 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginBottom: 4 },
  modalSubTitle: { fontSize: 12, textAlign: 'center', marginBottom: 12 },
  modalItem: { paddingVertical: 12, borderBottomWidth: 1 },
  modalItemText: { fontSize: 14, fontWeight: '500' },
  modalCancelBtn: { backgroundColor: '#ff4d4d', paddingVertical: 10, borderRadius: 6, alignItems: 'center', marginTop: 12 },
  modalCancelText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
});
