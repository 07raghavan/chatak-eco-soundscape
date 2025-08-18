# FFmpeg Binaries

The FFmpeg executable files (`ffmpeg.exe`, `ffplay.exe`, `ffprobe.exe`) are excluded from Git due to their large size (>100MB each).

## For Local Development

Download FFmpeg binaries from: https://ffmpeg.org/download.html

Place the following files in this directory:
- `ffmpeg.exe` - Main FFmpeg executable for audio/video processing
- `ffplay.exe` - Simple media player
- `ffprobe.exe` - Media stream analyzer

## For Production Deployment

### Railway/Docker Deployment
FFmpeg is automatically installed via the Dockerfile using:
```dockerfile
RUN apk add --no-cache ffmpeg
```

### AWS Elastic Beanstalk
FFmpeg installation is handled by the `.platform` configuration files.

## Alternative: System FFmpeg

The application will automatically detect system-installed FFmpeg if the binaries are not present in this directory. Ensure FFmpeg is available in your system PATH.
