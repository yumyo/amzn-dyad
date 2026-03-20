import { spawn } from "child_process";
import { writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import log from "electron-log";

const logger = log.scope("local_whisper");

/**
 * Transcribe audio using local Whisper models via whisper.cpp
 *
 * @param audioBuffer - The audio data as a Buffer
 * @param modelsPath - Path to the Whisper models directory
 * @returns The transcribed text
 */
export async function transcribeWithLocalWhisper(
  audioBuffer: Buffer,
  modelsPath: string,
): Promise<string> {
  const tempAudioPath = join(tmpdir(), `dyad-audio-${Date.now()}.webm`);
  const tempWavPath = join(tmpdir(), `dyad-audio-${Date.now()}.wav`);

  try {
    // Write the audio buffer to a temporary file
    writeFileSync(tempAudioPath, audioBuffer);
    logger.info(`Wrote audio to temporary file: ${tempAudioPath}`);

    // Convert webm to wav using ffmpeg
    await convertToWav(tempAudioPath, tempWavPath);
    logger.info(`Converted audio to WAV: ${tempWavPath}`);

    // Run whisper.cpp transcription
    // Try to find any ggml model file in the models directory
    const modelFiles = readdirSync(modelsPath).filter((f: string) => f.startsWith("ggml-") && f.endsWith(".bin"));

    if (modelFiles.length === 0) {
      throw new Error(`No Whisper model files found in ${modelsPath}`);
    }

    const modelPath = join(modelsPath, modelFiles[0]);
    logger.info(`Using Whisper model: ${modelFiles[0]}`);

    const text = await runWhisperCpp(tempWavPath, modelPath);
    logger.info(`Transcription completed: ${text.substring(0, 50)}...`);

    return text;
  } catch (error) {
    logger.error("Error transcribing with local Whisper:", error);
    throw error;
  } finally {
    // Clean up temporary files
    try {
      unlinkSync(tempAudioPath);
      unlinkSync(tempWavPath);
    } catch (err) {
      logger.warn("Failed to clean up temporary files:", err);
    }
  }
}

/**
 * Convert webm audio to WAV format using ffmpeg
 */
async function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", inputPath,
      "-ar", "16000", // 16kHz sample rate (Whisper standard)
      "-ac", "1",     // Mono channel
      "-f", "wav",
      outputPath,
      "-y",           // Overwrite output file
    ]);

    let stderr = "";

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

/**
 * Run whisper.cpp transcription
 */
async function runWhisperCpp(audioPath: string, modelPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use harker.app's bundled whisper.cpp executable
    const whisperCmd = "/Applications/harker.app/Contents/Resources/whisper-node/lib/whisper.cpp/main";

    const whisper = spawn(whisperCmd, [
      "-m", modelPath,
      "-f", audioPath,
      "--no-timestamps",
      "--language", "en",
    ]);

    let stdout = "";
    let stderr = "";

    whisper.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    whisper.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    whisper.on("close", (code) => {
      if (code === 0) {
        // Extract the transcribed text from output
        const text = stdout.trim();
        resolve(text);
      } else {
        reject(new Error(`whisper.cpp failed with code ${code}: ${stderr}`));
      }
    });

    whisper.on("error", (err) => {
      reject(
        new Error(
          `Failed to spawn whisper.cpp. Make sure whisper.cpp is installed and in your PATH: ${err.message}`
        )
      );
    });
  });
}
