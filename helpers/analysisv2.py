import yt_dlp
import librosa
import numpy as np
import os
import json
import requests
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# Constants
COOKIES_PATH = "Downloader/secret/youtube_cookies.txt"
TEMP_AUDIO_DIR = "temp_audio"  # dir to store temporary audio files in
OUTPUT_FILE = "output.parquet"
ERROR_LOG_FILE = "error_log.txt"
MAX_WORKERS = 6
DOWNLOAD_LONG = False  # Set to True to allow downloading songs over 15 minutes

# Ensure temporary directory exists
os.makedirs(TEMP_AUDIO_DIR, exist_ok=True)


# Function to log errors
def log_error(message: str):
    with open(ERROR_LOG_FILE, "a") as log_file:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_file.write(f"[{timestamp}] {message}\n")
        

def get_youtube_music_info(url: str):
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return {
                'title': info.get('title', 'No title found'),
                'duration': info.get('duration', 0),  # duration in seconds
            }
    except Exception as e:
        log_error(f"Failed to retrieve info for URL {url}: {e}")
        return {'title': 'Unknown Title', 'duration': 0}
    

def download_audio(video_url, output_path, cookies_path):
    try:
        ydl_opts = {
            "format": "bestaudio/best",
            "cookiefile": cookies_path,
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": "wav"}
            ],
            "outtmpl": output_path,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
        print(f"Downloaded and converted audio to {output_path}")
    except Exception as e:
        log_error(f"Failed to download audio for {video_url}: {e}")
        raise
    

def extract_audio_features(audio_path):
    try:
        y, sr = librosa.load(audio_path, sr=None)
        features = {
            "tempo": librosa.beat.tempo(y=y, sr=sr)[0],
            "mfcc": np.mean(librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13).T, axis=0),
            "spectral_contrast": np.mean(librosa.feature.spectral_contrast(y=y, sr=sr).T, axis=0),
            "chroma_stft": np.mean(librosa.feature.chroma_stft(y=y, sr=sr).T, axis=0),
        }
        print("Extracted audio features:", features)
        return features
    except Exception as e:
        log_error(f"Failed to extract features from {audio_path}: {e}")
        raise


def fetch_metadata(title, artist="Unknown"):
    try:
        base_url = "https://musicbrainz.org/ws/2/recording/"
        params = {"query": title, "fmt": "json"}
        response = requests.get(base_url, params=params)
        if response.status_code == 200:
            results = response.json().get("recordings", [])
            if results:
                metadata = {
                    "title": results[0].get("title"),
                    "artist": results[0].get("artist-credit", [{}])[0].get("artist", {}).get("name"),
                    "release_date": results[0].get("first-release-date"),
                    "genres": results[0].get("tags", []),
                }
                print("Fetched metadata from MusicBrainz:", metadata)
                return metadata
        log_error(f"No results from MusicBrainz for {title} by {artist}")
    except Exception as e:
        log_error(f"Failed to fetch metadata for {title}: {e}")
    return {"title": title, "artist": artist, "release_date": None, "genres": []}


def process_song(video_url):
    info = get_youtube_music_info(video_url)
    title = info['title']
    duration = info['duration']  # duration in seconds

    # Check if the song exceeds the allowed length
    if not DOWNLOAD_LONG and duration > 15 * 60:
        print(f"Skipping {title} (Duration: {duration / 60:.2f} minutes) as it exceeds 15 minutes.")
        log_error(f"Skipped {title} (Duration: {duration / 60:.2f} minutes) - too long.")
        with open(ERROR_LOG_FILE, "a") as log_file:
            log_file.write(f"{video_url},")
        return None

    audio_path = os.path.join(TEMP_AUDIO_DIR, f"{title.replace(' ', '_')}.wav")
    try:
        download_audio(video_url, audio_path.replace(".wav", ""), COOKIES_PATH)
        audio_features = extract_audio_features(audio_path)
        metadata = fetch_metadata(title)
        data = {
            **metadata,
            **{f"mfcc_{i}": val for i, val in enumerate(audio_features["mfcc"])},
            **{f"spectral_contrast_{i}": val for i, val in enumerate(audio_features["spectral_contrast"])},
            **{f"chroma_stft_{i}": val for i, val in enumerate(audio_features["chroma_stft"])},
            "tempo": audio_features["tempo"],
        }
        return data
    except Exception as e:
        log_error(f"Failed to process song {title} from URL {video_url}: {e}")
        return None
    finally:
        if os.path.exists(audio_path):
            os.remove(audio_path)


def read_urls_from_json(data_dir):
    urls = []
    for filename in os.listdir(data_dir):
        if filename.endswith(".json"):
            file_path = os.path.join(data_dir, filename)
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        urls.extend(data)
                    elif isinstance(data, dict) and "url" in data:
                        urls.append(data["url"])
            except json.JSONDecodeError as e:
                log_error(f"Failed to read JSON file {file_path}: {e}")
    return [url for url in urls if url]


if __name__ == "__main__":
    try:
        songs = read_urls_from_json('data')
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            results = list(executor.map(process_song, songs))
        processed_data = [result for result in results if result is not None]
        df = pd.DataFrame(processed_data)
        df.to_parquet(OUTPUT_FILE, engine="pyarrow", index=False)
        print(f"Data saved to {OUTPUT_FILE}")
    except Exception as e:
        log_error(f"Pipeline failed: {e}")
    finally:
        if os.path.exists(TEMP_AUDIO_DIR):
            os.rmdir(TEMP_AUDIO_DIR)
        print("Pipeline complete.")
