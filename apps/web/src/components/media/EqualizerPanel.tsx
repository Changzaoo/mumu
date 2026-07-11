import { EQ_BANDS_HZ, EQ_PRESETS } from '@aurial/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

const PRESET_LABELS: Record<string, string> = {
  flat: 'Neutro',
  bass: 'Graves',
  treble: 'Agudos',
  vocal: 'Voz',
  electronic: 'Eletrônica',
  rock: 'Rock',
  acoustic: 'Acústico',
};

function formatBand(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/**
 * 10-band EQ sheet (uiStore.activeModal === 'equalizer').
 * Wired straight to settingsStore; playerStore.initPlayerEngine syncs the engine.
 */
export function EqualizerPanel() {
  const open = useUiStore((s) => s.activeModal === 'equalizer');
  const setActiveModal = useUiStore((s) => s.setActiveModal);
  const eq = useSettingsStore((s) => s.eq);
  const setEqEnabled = useSettingsStore((s) => s.setEqEnabled);
  const setEqGain = useSettingsStore((s) => s.setEqGain);
  const setEqPreset = useSettingsStore((s) => s.setEqPreset);

  return (
    <Sheet open={open} onOpenChange={(next) => setActiveModal(next ? 'equalizer' : null)}>
      <SheetContent side="right" className="w-full max-w-md gap-6">
        <SheetHeader>
          <SheetTitle>Equalizador</SheetTitle>
          <SheetDescription>10 bandas · ±12 dB</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between">
          <Label htmlFor="eq-enabled" className="text-sm text-fg">
            Ativar equalizador
          </Label>
          <Switch id="eq-enabled" checked={eq.enabled} onCheckedChange={setEqEnabled} />
        </div>

        <div className="space-y-2">
          <Label>Predefinição</Label>
          <Select value={eq.preset ?? 'custom'} onValueChange={setEqPreset} disabled={!eq.enabled}>
            <SelectTrigger aria-label="Predefinição do equalizador">
              <SelectValue placeholder="Personalizado" />
            </SelectTrigger>
            <SelectContent>
              {eq.preset === null && (
                <SelectItem value="custom" disabled>
                  Personalizado
                </SelectItem>
              )}
              {Object.keys(EQ_PRESETS).map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {PRESET_LABELS[preset] ?? preset}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className={cn(
            'flex flex-1 items-stretch justify-between gap-1 pt-2 transition-opacity',
            !eq.enabled && 'pointer-events-none opacity-40',
          )}
        >
          {EQ_BANDS_HZ.map((hz, band) => (
            <div key={hz} className="flex min-h-56 flex-col items-center gap-2">
              <span className="font-mono text-[10px] tabular-nums text-fg-muted">
                {(eq.gains[band] ?? 0) > 0 ? '+' : ''}
                {eq.gains[band] ?? 0}
              </span>
              <Slider
                orientation="vertical"
                aria-label={`Banda ${formatBand(hz)} Hz`}
                min={-12}
                max={12}
                step={1}
                value={[eq.gains[band] ?? 0]}
                onValueChange={([value]) => setEqGain(band, value ?? 0)}
                className="flex-1"
              />
              <span className="font-mono text-[10px] text-fg-subtle">{formatBand(hz)}</span>
            </div>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setEqPreset('flat')}
          disabled={!eq.enabled}
        >
          Restaurar neutro
        </Button>
      </SheetContent>
    </Sheet>
  );
}
