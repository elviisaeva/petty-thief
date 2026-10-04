# Deep mode: frames and transcript (tier 2)

Only when the profile allows `download_video`, AND the user says yes for this exact video after you tell them the file, the source and the approximate size.

Work in a temporary folder: `tmp=$(mktemp -d)`. `"$tmp"` is your own variable; the video URL is untrusted and always goes in single quotes, with each `'` replaced by `'\''` (SKILL.md → Safety rules). Put `--` before it so a URL can never be read as an option.

1. Subtitles first (lighter):
   ```
   yt-dlp --skip-download --write-subs --write-auto-subs -o "$tmp/v" -- '<url>'
   ```
2. If frames are needed:
   ```
   yt-dlp -f "mp4/best" -o "$tmp/v.mp4" -- '<url>'
   ```
3. Frames (quality comes first):
   - **Videos up to 60 s:** one frame per second:
     ```
     ffmpeg -v error -i "$tmp/v.mp4" -vf fps=1 -frames:v 60 "$tmp/f%03d.jpg"
     ```
   - **Longer videos:** one frame per scene cut (step 4) plus one every 5 s in long shots, **at most 60**. Pick evenly if there are more.
4. Cuts:
   ```
   ffmpeg -i "$tmp/v.mp4" -vf "select='gt(scene,0.3)',showinfo" -f null - 2>&1 | grep -c pts_time
   ```
5. Transcript, if the profile allows `transcribe`:
   ```
   ffmpeg -v error -i "$tmp/v.mp4" -ar 16000 -ac 1 "$tmp/a.wav"
   ```
   then `whisper-cli -m '<model path>' -f "$tmp/a.wav" -l auto -osrt -of "$tmp/a"`.
6. Build a table by second: what is in frame, on-screen text, shot type (face / screen / hands / b-roll), cut or not, and the spoken line from the transcript.
7. `rm -rf "$tmp"`, then tell the user the files were deleted.

Quote hooks from the transcript, not from auto-captions, when both exist.
