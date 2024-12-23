import yt_dlp
import librosa
import numpy as np
import os
import requests
import pandas as pd
import numpy as np

# Constants
COOKIES_PATH = "youtube_cookies.txt"  # Path to your cookies file
OUTPUT_AUDIO = "audio.wav"  # Output audio file for Librosa processing


# Step 1: Download audio from YouTube
def download_audio(video_url, output_path, cookies_path):
    ydl_opts = {
        "format": "bestaudio/best",
        "cookiefile": cookies_path,
        "postprocessors": [
            {  # Convert audio to WAV format for Librosa
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
            }
        ],
        "outtmpl": output_path,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([video_url])
    print(f"Downloaded and converted audio to {output_path}")


# Step 2: Extract audio features using Librosa
def extract_audio_features(audio_path):
    y, sr = librosa.load(audio_path, sr=None)  # Load audio
    features = {
        "tempo": librosa.feature.tempo(y=y, sr=sr)[0],  # Tempo in BPM
        "mfcc": np.mean(librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13).T, axis=0),  # MFCCs
        "spectral_contrast": np.mean(
            librosa.feature.spectral_contrast(y=y, sr=sr).T, axis=0
        ),
        "chroma_stft": np.mean(librosa.feature.chroma_stft(y=y, sr=sr).T, axis=0),
    }
    print("Extracted audio features:", features)
    return features


# Step 3: Query MusicBrainz or Discogs for metadata
def fetch_metadata(title, artist):
    # Example: Fetch metadata from MusicBrainz
    base_url = "https://musicbrainz.org/ws/2/recording/"
    params = {
        "query": f"{title} AND artist:{artist}",
        "fmt": "json",
    }
    response = requests.get(base_url, params=params)
    if response.status_code == 200:
        results = response.json().get("recordings", [])
        if results:
            metadata = {
                "title": results[0].get("title"),
                "artist": results[0]
                .get("artist-credit", [{}])[0]
                .get("artist", {})
                .get("name"),
                "release_date": results[0].get("first-release-date"),
                "genres": results[0].get("tags", []),
            }
            print("Fetched metadata from MusicBrainz:", metadata)
            return metadata
        else:
            print("No results found on MusicBrainz.")
    else:
        print(f"MusicBrainz API error: {response.status_code}")
    return None


# Main pipeline (one at a time)
if __name__ == "__main__":
    video_url = "https://www.youtube.com/watch?v=UoCxdh7qQHE"

    # Step 1: Download audio
    download_audio(video_url, OUTPUT_AUDIO.replace(".wav", ""), COOKIES_PATH)

    # Step 2: Extract audio features
    audio_features = extract_audio_features(OUTPUT_AUDIO)

    # Step 3: Fetch metadata
    youtube_title = "Turning Into Night"  # Example, fetch dynamically from yt-dlp metadata if needed
    youtube_artist = "Jamie Berry"
    metadata = fetch_metadata(youtube_title, youtube_artist)

    data = {
        **metadata,
        **{f"mfcc_{i}": val for i, val in enumerate(audio_features["mfcc"])},
        **{
            f"spectral_contrast_{i}": val
            for i, val in enumerate(audio_features["spectral_contrast"])
        },
        **{
            f"chroma_stft_{i}": val
            for i, val in enumerate(audio_features["chroma_stft"])
        },
        "tempo": audio_features["tempo"],
    }

    # Convert to a DataFrame
    df = pd.DataFrame([data])

    # Save to Parquet
    output_file = "output.parquet"
    df.to_parquet(output_file, engine="pyarrow", index=False)

    # Clean up downloaded audio (optional)
    os.remove(OUTPUT_AUDIO)
    print("Pipeline complete.")
    