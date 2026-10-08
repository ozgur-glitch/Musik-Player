import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  StatusBar,
  Alert,
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';

const STORAGE_KEY = '@musik_player_rangliste_v1';

export default function App() {
  const [playlist, setPlaylist] = useState([]);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const audioRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    loadPlaylistData();

    return () => {
      stopListenTimer();
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const startListenTimer = (trackId) => {
    stopListenTimer();
    timerRef.current = setInterval(() => {
      setPlaylist((prevPlaylist) => {
        const updated = prevPlaylist.map((item) => {
          if (item.id === trackId) {
            return { ...item, listenTime: (item.listenTime || 0) + 1 };
          }
          return item;
        });
        savePlaylistToStorage(updated);
        return updated;
      });
    }, 1000);
  };

  const stopListenTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const loadPlaylistData = async () => {
    try {
      const savedPlaylist = await AsyncStorage.getItem(STORAGE_KEY);
      if (savedPlaylist !== null) {
        const parsed = JSON.parse(savedPlaylist);
        setPlaylist(parsed);
        if (parsed.length > 0) setCurrentTrack(parsed[0]);
      }
    } catch (e) {
      console.error('Fehler beim Laden:', e);
    }
  };

  const savePlaylistToStorage = async (newList) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newList));
    } catch (e) {
      console.error('Fehler beim Speichern:', e);
    }
  };

  const handlePickLocalFile = () => {
    if (Platform.OS === 'web' || typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const localUrl = URL.createObjectURL(file);
          const newTrack = {
            id: Date.now().toString(),
            title: file.name,
            url: localUrl,
            listenTime: 0,
          };
          addTrackToPlaylist(newTrack);
        }
      };
      input.click();
    } else {
      Alert.alert(
        'Lokale Dateien',
        'Bitte öffne das Projekt im Web-Modus oder Expo Web, um lokale Dateien direkt auszuwählen.'
      );
    }
  };

  const addTrackToPlaylist = async (newTrack) => {
    const updated = [...playlist, newTrack];
    setPlaylist(updated);
    await savePlaylistToStorage(updated);

    if (!currentTrack) {
      setCurrentTrack(newTrack);
    }
  };

  const playTrack = (track) => {
    setCurrentTrack(track);

    if (typeof Audio !== 'undefined') {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      audioRef.current = new Audio(track.url);
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          startListenTimer(track.id);
        })
        .catch(() => Alert.alert('Fehler', 'Audiodatei konnte nicht abgespielt werden.'));

      audioRef.current.onended = () => {
        setIsPlaying(false);
        stopListenTimer();
      };
    }
  };

  const togglePlayPause = () => {
    if (!currentTrack) return;

    if (!audioRef.current) {
      playTrack(currentTrack);
      return;
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      stopListenTimer();
    } else {
      audioRef.current
        .play()
        .then(() => {
          setIsPlaying(true);
          startListenTimer(currentTrack.id);
        })
        .catch(() => Alert.alert('Fehler', 'Wiedergabe fehlgeschlagen.'));
    }
  };

  const handleDeleteTrack = async (id) => {
    if (currentTrack && currentTrack.id === id) {
      stopListenTimer();
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setIsPlaying(false);
    }

    const updated = playlist.filter((item) => item.id !== id);
    setPlaylist(updated);
    await savePlaylistToStorage(updated);

    if (currentTrack && currentTrack.id === id) {
      setCurrentTrack(updated.length > 0 ? updated[0] : null);
    }
  };

  const formatDuration = (totalSeconds = 0) => {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s`;
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    return `${hours}h ${remMin}m`;
  };

  const rankedPlaylist = [...playlist].sort(
    (a, b) => (b.listenTime || 0) - (a.listenTime || 0)
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#121212" />

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Musik Player</Text>
        <TouchableOpacity style={styles.addButton} onPress={handlePickLocalFile}>
          <Ionicons name="folder-open-outline" size={26} color="#1DB954" />
        </TouchableOpacity>
      </View>

      {/* PLAYER BEREICH */}
      <View style={styles.playerContainer}>
        <View style={styles.coverArt}>
          <Ionicons name="musical-notes" size={60} color="#1DB954" />
        </View>

        <Text style={styles.trackTitle} numberOfLines={1}>
          {currentTrack ? currentTrack.title : 'Keine MP3 gewählt'}
        </Text>

        {currentTrack && (
          <View style={styles.listenTimeBadge}>
            <Ionicons name="time-outline" size={14} color="#1DB954" style={{ marginRight: 4 }} />
            <Text style={styles.listenTimeBadgeText}>
              Gehört: {formatDuration(playlist.find((t) => t.id === currentTrack.id)?.listenTime || 0)}
            </Text>
          </View>
        )}

        <TouchableOpacity
          onPress={togglePlayPause}
          style={styles.playBtn}
          disabled={!currentTrack}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={36} color="#121212" />
        </TouchableOpacity>
      </View>

      {/* RANGLISTE & PLAYLIST */}
      <View style={styles.playlistContainer}>
        <Text style={styles.playlistTitle}>🏆 Top Rangliste (nach Hördauer)</Text>

        <FlatList
          data={rankedPlaylist}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            const isSelected = currentTrack?.id === item.id;
            const rank = index + 1;

            return (
              <TouchableOpacity
                style={[styles.item, isSelected && styles.selectedItem]}
                onPress={() => playTrack(item)}
              >
                <View
                  style={[
                    styles.rankBadge,
                    rank === 1 && styles.rank1,
                    rank === 2 && styles.rank2,
                    rank === 3 && styles.rank3,
                  ]}
                >
                  <Text style={styles.rankText}>#{rank}</Text>
                </View>

                <View style={{ flex: 1, marginHorizontal: 10 }}>
                  <Text
                    style={{
                      color: isSelected ? '#1DB954' : '#fff',
                      fontWeight: isSelected ? 'bold' : 'normal',
                    }}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>

                  <Text style={styles.timeSubtext}>
                    ⏱️ {formatDuration(item.listenTime || 0)} angehört
                  </Text>
                </View>

                <TouchableOpacity onPress={() => handleDeleteTrack(item.id)}>
                  <Ionicons name="trash-outline" size={20} color="#ff4d4d" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <TouchableOpacity style={styles.emptyBox} onPress={handlePickLocalFile}>
              <Ionicons name="cloud-upload-outline" size={40} color="#1DB954" />
              <Text style={styles.emptyText}>Tippen, um MP3-Datei vom Handy zu wählen</Text>
            </TouchableOpacity>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', padding: 20 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  addButton: { padding: 4 },
  playerContainer: {
    alignItems: 'center',
    backgroundColor: '#181818',
    padding: 20,
    borderRadius: 12,
    marginVertical: 15,
  },
  coverArt: {
    width: 80,
    height: 80,
    backgroundColor: '#282828',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  trackTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 5,
    textAlign: 'center',
  },
  listenTimeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginVertical: 10,
  },
  listenTimeBadgeText: {
    color: '#1DB954',
    fontSize: 12,
    fontWeight: 'bold',
  },
  playBtn: {
    backgroundColor: '#1DB954',
    padding: 15,
    borderRadius: 40,
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 5,
  },
  playlistContainer: { flex: 1 },
  playlistTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#181818',
    borderRadius: 8,
    marginBottom: 8,
  },
  selectedItem: { borderColor: '#1DB954', borderWidth: 1 },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rank1: { backgroundColor: '#FFD700' },
  rank2: { backgroundColor: '#C0C0C0' },
  rank3: { backgroundColor: '#CD7F32' },
  rankText: {
    color: '#121212',
    fontWeight: 'bold',
    fontSize: 12,
  },
  timeSubtext: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  emptyBox: {
    marginTop: 20,
    padding: 30,
    borderWidth: 1,
    borderColor: '#333',
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { color: '#888', marginTop: 10, textAlign: 'center' },
});
