'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { QuickReplyPicker } from './quick-reply-picker';
import {
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
  deleteAccountMedia,
} from '@/lib/storage/upload-media';
import type { QuickReply } from '@/types';
import { useAuth } from '@/hooks/use-auth';

type Kind = 'image' | 'video' | 'document' | 'audio';
const ACCEPT: Record<Kind, string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document:
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain',
  audio: 'audio/ogg,audio/mpeg,audio/aac,audio/mp4,audio/amr',
};
const EMOJIS = [
  '😀',
  '😊',
  '😍',
  '😂',
  '🙏',
  '👍',
  '👏',
  '🤝',
  '❤️',
  '🔥',
  '✅',
  '🎉',
  '📅',
  '📞',
  '💬',
  '🚀',
];

export function GroupComposer({
  groupJid,
  onSent,
}: {
  groupJid: string;
  onSent: () => void;
}) {
  const { accountId } = useAuth();
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ kind: Kind; value: File } | null>(null);
  const [sending, setSending] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const pickerRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<Kind>('document');
  const recorderRef = useRef<import('opus-recorder').default | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () => setSeconds((previous) => previous + 1),
      1000
    );
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    if (recording && seconds >= 300) void stopRecording();
  }, [recording, seconds]);
  useEffect(
    () => () => {
      cancelledRef.current = true;
      void recorderRef.current?.stop().catch(() => {});
    },
    []
  );

  function choose(kind: Kind, value?: File) {
    if (!value) return;
    if (
      !ACCEPT[kind].split(',').includes(value.type) ||
      value.size > MEDIA_MAX_BYTES_BY_KIND[kind] ||
      value.size === 0
    ) {
      toast.error(
        'Arquivo inválido ou acima do limite permitido (imagem: 5 MB; demais: 16 MB).'
      );
      return;
    }
    setFile({ kind, value });
  }
  function openPicker(kind: Kind) {
    kindRef.current = kind;
    if (pickerRef.current) pickerRef.current.accept = ACCEPT[kind];
    pickerRef.current?.click();
  }
  async function startRecording() {
    if (sending || recording) return;
    try {
      const { default: Recorder } = await import('opus-recorder');
      const recorder = new Recorder({
        encoderPath: '/opus/encoderWorker.min.js',
        numberOfChannels: 1,
        encoderApplication: 2048,
        encoderSampleRate: 48000,
        streamPages: false,
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (!cancelledRef.current && bytes.length)
          choose(
            'audio',
            new File(
              [bytes as unknown as BlobPart],
              `audio-${Date.now()}.ogg`,
              { type: 'audio/ogg' }
            )
          );
      };
      recorderRef.current = recorder;
      await recorder.start();
      setSeconds(0);
      setRecording(true);
    } catch {
      toast.error('Não foi possível acessar o microfone.');
    }
  }
  async function stopRecording() {
    setRecording(false);
    await recorderRef.current
      ?.stop()
      .catch(() => toast.error('Não foi possível concluir o áudio.'));
    recorderRef.current = null;
  }
  async function send() {
    if (sending || recording || (!text.trim() && !file)) return;
    const sendingText = text.trim();
    const sendingFile = file;
    if (
      sendingFile &&
      sendingFile.kind !== 'audio' &&
      sendingText.length > 1024
    ) {
      toast.error('A legenda do anexo pode ter no máximo 1024 caracteres.');
      return;
    }
    setText(sendingFile?.kind === 'audio' ? sendingText : '');
    setFile(null);
    setSending(true);
    try {
      const uploaded = sendingFile
        ? await uploadAccountMedia(
            'chat-media',
            sendingFile.value,
            'group-chat',
            accountId ?? undefined
          )
        : null;
      const response = await fetch('/api/whatsapp/groups/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          groupJid,
          kind: sendingFile?.kind ?? 'text',
          text: sendingFile?.kind === 'audio' ? '' : sendingText,
          mediaUrl: uploaded?.publicUrl,
          mediaName: sendingFile?.value.name,
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        if (uploaded && (response.status < 500 || response.status === 502))
          void deleteAccountMedia('chat-media', uploaded.path).catch(() => {});
        throw new Error(result?.error ?? 'Não foi possível enviar ao grupo.');
      }
      onSent();
    } catch (error) {
      setText(sendingText);
      setFile(sendingFile);
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar mensagem.'
      );
    } finally {
      setSending(false);
    }
  }
  function pickQuick(reply: QuickReply) {
    setQuickOpen(false);
    if (reply.kind !== 'text' || !reply.content_text) {
      toast.error('Este modelo de mensagem não é compatível com grupos.');
      return;
    }
    setText(
      (previous) =>
        `${previous === '/' ? '' : previous}${previous && previous !== '/' && !/\s$/.test(previous) ? '\n' : ''}${reply.content_text}`
    );
  }

  return (
    <form
      className="bg-card shrink-0 space-y-2 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return;
        event.preventDefault();
        const value = event.dataTransfer.files[0];
        const kind: Kind = value.type.startsWith('image/')
          ? 'image'
          : value.type.startsWith('video/')
            ? 'video'
            : value.type.startsWith('audio/')
              ? 'audio'
              : 'document';
        choose(kind, value);
      }}
    >
      <input
        ref={pickerRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          choose(kindRef.current, event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {file && (
        <div className="bg-muted flex min-w-0 items-center gap-2 rounded-md p-2 text-xs">
          <Paperclip className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-all">{file.value.name}</span>
          <button
            type="button"
            aria-label="Remover anexo"
            onClick={() => setFile(null)}
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <div className="flex items-center gap-1">
        <DropdownMenu open={emojiOpen} onOpenChange={setEmojiOpen}>
          <DropdownMenuTrigger
            aria-label="Emojis"
            title="Emojis"
            disabled={sending}
            className="text-muted-foreground hover:bg-muted flex size-8 items-center justify-center rounded"
          >
            <Smile className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="grid grid-cols-8 gap-1 p-2"
          >
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="hover:bg-muted rounded p-1 text-lg"
                onClick={() => {
                  setText((value) => value + emoji);
                  setEmojiOpen(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="Mensagens rápidas"
          title="Mensagens rápidas"
          disabled={sending}
          className="text-muted-foreground hover:bg-muted flex size-8 items-center justify-center rounded"
          onClick={() => setQuickOpen(true)}
        >
          <Zap className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Anexar arquivo"
            title="Anexar arquivo"
            disabled={sending}
            className="text-muted-foreground hover:bg-muted flex size-8 items-center justify-center rounded"
          >
            <Paperclip className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => openPicker('image')}>
              <ImageIcon className="mr-2 size-4" />
              Imagem
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPicker('video')}>
              <Video className="mr-2 size-4" />
              Vídeo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPicker('document')}>
              <FileText className="mr-2 size-4" />
              Documento
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openPicker('audio')}>
              <Mic className="mr-2 size-4" />
              Áudio
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {recording ? (
          <>
            <span className="text-destructive ml-2 text-xs">
              Gravando {Math.floor(seconds / 60)}:
              {String(seconds % 60).padStart(2, '0')}
            </span>
            <button
              type="button"
              aria-label="Cancelar gravação"
              className="ml-auto"
              onClick={() => {
                cancelledRef.current = true;
                void stopRecording();
              }}
            >
              <X className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Concluir gravação"
              onClick={() => void stopRecording()}
            >
              <Square className="size-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-label="Gravar áudio"
            title="Gravar áudio"
            disabled={sending}
            className="text-muted-foreground hover:bg-muted flex size-8 items-center justify-center rounded"
            onClick={() => void startRecording()}
          >
            <Mic className="size-4" />
          </button>
        )}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          aria-label="Mensagem para o grupo"
          placeholder="Digite uma mensagem para o grupo…"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value === '/') setQuickOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          disabled={sending}
          maxLength={file && file.kind !== 'audio' ? 1024 : 4096}
          className="bg-background min-h-12 min-w-0 flex-1 resize-none rounded-lg border p-2 text-sm"
        />
        <button
          type="submit"
          disabled={sending || recording || (!text.trim() && !file)}
          aria-label="Enviar mensagem para o grupo"
          className="bg-primary text-primary-foreground flex size-11 shrink-0 items-center justify-center rounded-lg disabled:opacity-50"
        >
          {sending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </div>
      <QuickReplyPicker
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onPick={pickQuick}
      />
    </form>
  );
}
