/**
 * /settings — preferences in cards. Local settings persist instantly via
 * settingsStore; account-side settings (notificações, sessão privada) go to
 * PATCH /me. Theme previews render live swatches for both themes.
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AudioWaveform,
  Bell,
  Globe,
  Info,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Play,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AUDIO_QUALITIES, type AudioQuality } from '@aurial/shared';
import { AurialMark } from '@/components/brand/AurialMark';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useUpdateMe } from '@/features/profile/api';
import { useAuthUser } from '@/hooks/useAuthUser';
import { api } from '@/lib/api';
import { logout } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useSettingsStore, type ThemeSetting } from '@/stores/settingsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

const APP_VERSION = '0.1.0';

const QUALITY_LABEL: Record<AudioQuality, string> = {
  low: 'Econômica (96 kbps)',
  normal: 'Normal (160 kbps)',
  high: 'Alta (320 kbps)',
  lossless: 'Sem perdas (FLAC)',
};

function saved(): void {
  toast('Salvo');
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-border bg-bg-elevated p-5 md:p-6"
    >
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-fg/5 text-fg-muted">
          <Icon className="size-[18px]" />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
        </div>
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm text-fg">
          {label}
        </Label>
        {hint && <p className="text-xs text-fg-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Theme option with a miniature live preview swatch. */
function ThemeOption({
  value,
  label,
  icon: Icon,
  active,
  onSelect,
}: {
  value: ThemeSetting;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: (theme: ThemeSetting) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onSelect(value)}
      className={cn(
        'flex-1 rounded-lg border p-3 text-left transition-colors duration-200',
        active ? 'border-accent bg-accent/5' : 'border-border hover:border-fg/25',
      )}
    >
      {/* Preview swatch */}
      <span
        aria-hidden
        className={cn(
          'mb-2 flex h-12 w-full items-end gap-1 overflow-hidden rounded-md border border-border p-1.5',
          value === 'dark' && 'bg-[hsl(240_6%_4%)]',
          value === 'light' && 'bg-[hsl(0_0%_99%)]',
          value === 'system' && 'bg-gradient-to-r from-[hsl(240_6%_4%)] to-[hsl(0_0%_99%)]',
        )}
      >
        <span className="h-3 w-1/3 rounded-sm bg-accent" />
        <span
          className={cn(
            'h-2 w-1/4 rounded-sm',
            value === 'light' ? 'bg-[hsl(240_6%_7%)]/30' : 'bg-white/25',
          )}
        />
      </span>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
        <Icon className="size-3.5" /> {label}
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useSettingsStore();
  const setRate = usePlayerStore((s) => s.setRate);
  const playbackRate = usePlayerStore((s) => s.playbackRate);
  const setActiveModal = useUiStore((s) => s.setActiveModal);
  const { user, profile } = useAuthUser();
  const updateMe = useUpdateMe();

  const [notifications, setNotifications] = useState(profile?.settings?.notifications ?? true);
  const [privateSession, setPrivateSession] = useState(profile?.settings?.privateSession ?? false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearHistoryOpen, setClearHistoryOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);

  const patchAccountSetting = (partial: {
    notifications?: boolean;
    privateSession?: boolean;
  }): void => {
    if (!user) return;
    updateMe.mutate({ settings: partial });
  };

  const requestPush = async (): Promise<void> => {
    if (!('Notification' in window)) {
      toast.error('Este navegador não suporta notificações.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') toast('Notificações ativadas neste dispositivo');
    else toast('Permissão de notificações não concedida');
  };

  const clearHistory = async (): Promise<void> => {
    setClearingHistory(true);
    try {
      // Contract has no DELETE /me/history — try it, fall back to local cache clear.
      await api.del('/me/history');
      toast('Histórico apagado');
    } catch {
      queryClient.removeQueries({ queryKey: ['history'] });
      toast('Histórico local limpo');
    } finally {
      setClearingHistory(false);
      setClearHistoryOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <h1 className="text-3xl font-bold tracking-tight text-fg">Configurações</h1>

      {/* Aparência */}
      <SettingsCard
        icon={Palette}
        title="Aparência"
        description="Tema, contraste e tamanho do texto"
      >
        <div role="radiogroup" aria-label="Tema" className="flex gap-3">
          <ThemeOption
            value="dark"
            label="Escuro"
            icon={Moon}
            active={settings.theme === 'dark'}
            onSelect={(t) => {
              settings.setTheme(t);
              saved();
            }}
          />
          <ThemeOption
            value="light"
            label="Claro"
            icon={Sun}
            active={settings.theme === 'light'}
            onSelect={(t) => {
              settings.setTheme(t);
              saved();
            }}
          />
          <ThemeOption
            value="system"
            label="Sistema"
            icon={Monitor}
            active={settings.theme === 'system'}
            onSelect={(t) => {
              settings.setTheme(t);
              saved();
            }}
          />
        </div>
        <Row label="Alto contraste" hint="Reforça bordas e textos" htmlFor="st-hc">
          <Switch
            id="st-hc"
            checked={settings.highContrast}
            onCheckedChange={(checked) => {
              settings.setHighContrast(checked);
              saved();
            }}
          />
        </Row>
        <div className="space-y-2">
          <Row label="Tamanho da fonte" hint={`${Math.round(settings.fontScale * 100)}%`}>
            <span className="w-40">
              <Slider
                aria-label="Tamanho da fonte"
                min={0.875}
                max={1.25}
                step={0.025}
                value={[settings.fontScale]}
                onValueChange={([value]) => settings.setFontScale(value ?? 1)}
                onValueCommit={saved}
              />
            </span>
          </Row>
        </div>
      </SettingsCard>

      {/* Idioma */}
      <SettingsCard icon={Globe} title="Idioma">
        <Row label="Idioma da interface" htmlFor="st-lang">
          <Select
            value={settings.language}
            onValueChange={(value) => {
              settings.setLanguage(value);
              saved();
            }}
          >
            <SelectTrigger id="st-lang" className="w-48" aria-label="Idioma da interface">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
              <SelectItem value="en">English (em breve)</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </SettingsCard>

      {/* Reprodução */}
      <SettingsCard
        icon={Play}
        title="Reprodução"
        description="Qualidade e transições entre faixas"
      >
        <Row label="Qualidade do áudio" htmlFor="st-quality">
          <Select
            value={settings.audioQuality}
            onValueChange={(value) => {
              settings.setAudioQuality(value as AudioQuality);
              saved();
            }}
          >
            <SelectTrigger id="st-quality" className="w-56" aria-label="Qualidade do áudio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIO_QUALITIES.map((quality) => (
                <SelectItem key={quality} value={quality}>
                  {QUALITY_LABEL[quality]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row
          label="Crossfade"
          hint={settings.crossfadeSeconds > 0 ? `${settings.crossfadeSeconds} s` : 'Desativado'}
        >
          <span className="w-40">
            <Slider
              aria-label="Crossfade em segundos"
              min={0}
              max={12}
              step={1}
              value={[settings.crossfadeSeconds]}
              onValueChange={([value]) => settings.setCrossfadeSeconds(value ?? 0)}
              onValueCommit={saved}
            />
          </span>
        </Row>
        <Row label="Reprodução sem pausas" hint="Pré-carrega a próxima faixa" htmlFor="st-gapless">
          <Switch
            id="st-gapless"
            checked={settings.gapless}
            onCheckedChange={(checked) => {
              settings.setGapless(checked);
              saved();
            }}
          />
        </Row>
        <Row
          label="Normalizar volume"
          hint="Mesmo volume entre faixas (ReplayGain)"
          htmlFor="st-normalize"
        >
          <Switch
            id="st-normalize"
            checked={settings.normalizeVolume}
            onCheckedChange={(checked) => {
              settings.setNormalizeVolume(checked);
              saved();
            }}
          />
        </Row>
        <Row label="Velocidade de reprodução" hint={`${playbackRate.toFixed(2)}×`}>
          <Button
            variant="outline"
            size="sm"
            disabled={playbackRate === 1}
            onClick={() => {
              setRate(1);
              saved();
            }}
          >
            Restaurar 1×
          </Button>
        </Row>
      </SettingsCard>

      {/* Equalizador */}
      <SettingsCard
        icon={SlidersHorizontal}
        title="Equalizador"
        description="10 bandas com predefinições"
      >
        <Row
          label={settings.eq.enabled ? 'Ativado' : 'Desativado'}
          hint={settings.eq.preset ? `Predefinição: ${settings.eq.preset}` : 'Personalizado'}
        >
          <Button variant="outline" size="sm" onClick={() => setActiveModal('equalizer')}>
            <AudioWaveform /> Abrir equalizador
          </Button>
        </Row>
      </SettingsCard>

      {/* Notificações */}
      <SettingsCard icon={Bell} title="Notificações">
        <Row
          label="Notificações da conta"
          hint="Novidades de quem você segue"
          htmlFor="st-notifications"
        >
          <Switch
            id="st-notifications"
            checked={notifications}
            disabled={!user}
            onCheckedChange={(checked) => {
              setNotifications(checked);
              patchAccountSetting({ notifications: checked });
            }}
          />
        </Row>
        <Row label="Push neste dispositivo" hint="Requer permissão do navegador">
          <Button variant="outline" size="sm" onClick={() => void requestPush()}>
            Permitir push
          </Button>
        </Row>
      </SettingsCard>

      {/* Privacidade */}
      <SettingsCard icon={Lock} title="Privacidade">
        <Row label="Sessão privada" hint="Não registra o que você ouve" htmlFor="st-private">
          <Switch
            id="st-private"
            checked={privateSession}
            disabled={!user}
            onCheckedChange={(checked) => {
              setPrivateSession(checked);
              patchAccountSetting({ privateSession: checked });
            }}
          />
        </Row>
        <Row label="Histórico de reprodução" hint="Apaga sua linha do tempo">
          <Button variant="outline" size="sm" onClick={() => setClearHistoryOpen(true)}>
            <Trash2 /> Limpar histórico
          </Button>
        </Row>
      </SettingsCard>

      {/* Conta */}
      <SettingsCard icon={UserRound} title="Conta">
        {user ? (
          <>
            <div className="flex items-center gap-3">
              <Avatar className="size-11">
                {(profile?.avatarUrl ?? user.photoURL) && (
                  <AvatarImage src={profile?.avatarUrl ?? user.photoURL ?? undefined} alt="" />
                )}
                <AvatarFallback>
                  {(profile?.displayName ?? user.displayName ?? 'A').slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="line-clamp-1 text-sm font-medium text-fg">
                  {profile?.displayName ?? user.displayName ?? 'Conta Aurial'}
                  {profile?.isPremium && (
                    <Badge variant="accent" className="ml-2 align-middle">
                      Premium
                    </Badge>
                  )}
                </p>
                <p className="line-clamp-1 text-[13px] text-fg-muted">
                  {profile?.email ?? user.email ?? 'sem e-mail'}
                </p>
              </div>
            </div>
            <Row label="Perfil público" hint="Nome, foto e playlists">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigate(`/profile/${profile?.handle ?? profile?.id ?? ''}`)}
                disabled={!profile}
              >
                Ver perfil
              </Button>
            </Row>
            <Row label="Sair da conta">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void logout().then(() => {
                    toast('Você saiu da conta');
                    void navigate('/login');
                  });
                }}
              >
                <LogOut /> Sair
              </Button>
            </Row>
            <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
              <Row label="Excluir conta" hint="Remove seus dados de forma permanente">
                <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                  Excluir
                </Button>
              </Row>
            </div>
          </>
        ) : (
          <Row label="Você não está conectado" hint="Entre para sincronizar sua biblioteca">
            <Button variant="accent" size="sm" onClick={() => void navigate('/login')}>
              Entrar
            </Button>
          </Row>
        )}
      </SettingsCard>

      {/* Sobre */}
      <SettingsCard icon={Info} title="Sobre">
        <div className="flex items-center gap-3">
          <AurialMark className="size-8" />
          <div>
            <p className="text-sm font-medium text-fg">Aurial</p>
            <p className="font-mono text-xs tabular-nums text-fg-muted">versão {APP_VERSION}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <a href="/docs" className="text-fg-muted transition-colors hover:text-fg">
            Documentação
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer noopener"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            Código-fonte
          </a>
        </div>
      </SettingsCard>

      {/* Clear history confirm */}
      <Dialog open={clearHistoryOpen} onOpenChange={setClearHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar histórico</DialogTitle>
            <DialogDescription>
              Todo o seu histórico de reprodução será apagado. Suas recomendações podem levar um
              tempo para se ajustar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClearHistoryOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={clearingHistory}
              onClick={() => void clearHistory()}
            >
              {clearingHistory && <Loader2 className="animate-spin" />}
              Limpar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete account stub */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir conta</DialogTitle>
            <DialogDescription>
              A exclusão de conta ainda não está disponível pelo app. Fale com o suporte para
              concluir o processo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
