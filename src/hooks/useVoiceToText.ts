import { useState, useRef, useCallback, useEffect } from "react";
import { ipc } from "@/ipc/types";
import { v4 as uuidv4 } from "uuid";

interface UseVoiceToTextOptions {
  enabled: boolean;
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceToText({
  enabled,
  onTranscription,
  onError,
}: UseVoiceToTextOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const skipOnStopProcessingRef = useRef(false);

  const stopMediaStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      skipOnStopProcessingRef.current = true;
      const mediaRecorder = mediaRecorderRef.current;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      mediaRecorderRef.current = null;
      stopMediaStream();
      chunksRef.current = [];
    };
  }, [stopMediaStream]);

  const toggleRecording = useCallback(async () => {
    console.log("toggleRecording called:", { isRecording, isTranscribing, enabled });

    if (isTranscribing) {
      console.log("Already transcribing, ignoring click");
      return;
    }

    if (isRecording) {
      // Stop recording
      console.log("Stopping recording, mediaRecorder state:", mediaRecorderRef.current?.state);
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
        console.log("Called stop() on mediaRecorder");
      }
      return;
    }

    if (!enabled) {
      console.log("Voice-to-text not enabled");
      return;
    }

    // Start recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log("mediaRecorder.onstop triggered");
        mediaRecorderRef.current = null;
        stopMediaStream();
        if (skipOnStopProcessingRef.current) {
          console.log("Skipping processing due to skipOnStopProcessingRef");
          chunksRef.current = [];
          return;
        }

        console.log("Setting isRecording to false");
        setIsRecording(false);

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        console.log("Created blob, size:", blob.size);
        chunksRef.current = [];

        if (blob.size === 0) {
          console.log("Blob size is 0, not transcribing");
          return;
        }

        console.log("Starting transcription...");
        setIsTranscribing(true);
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const audioData = Array.from(new Uint8Array(arrayBuffer));
          console.log("Audio data length:", audioData.length);

          const result = await ipc.audio.transcribeAudio({
            audioData,
            filename: "recording.webm",
            requestId: uuidv4(),
          });

          console.log("Transcription result:", result);

          if (result.text.trim()) {
            console.log("Calling onTranscription with text:", result.text.trim());
            onTranscription(result.text.trim());
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Transcription failed";
          console.error("Transcription error:", err);
          onError?.(message);
        } finally {
          console.log("Setting isTranscribing to false");
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      stopMediaStream();
      const message =
        err instanceof Error ? err.message : "Failed to access microphone";
      onError?.(message);
    }
  }, [
    enabled,
    isRecording,
    isTranscribing,
    onTranscription,
    onError,
    stopMediaStream,
  ]);

  return {
    isRecording,
    isTranscribing,
    toggleRecording,
  };
}
