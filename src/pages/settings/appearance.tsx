import { Check, MicVocal, Palette } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Switch } from '../../components/Switch';
import { useEffectiveTheme } from '../../hooks/useSystemTheme';
import { clearAllOverrides, countOverrides } from '../../lib/lyricsStore';
import { SCHEME_STYLES, SEED_PRESETS, schemeFromSeed, type ContrastLevel, type SchemeStyle } from '../../lib/material';
import type { BackdropEffect, ThemeMode } from '../../lib/types';
import { useSettings, type SettingsValues } from '../../store/settings';
import { toast, useUi } from '../../store/ui';
import { Group, Row, Segmented } from './ui';

const BACKDROPS: { id: BackdropEffect; label: string; hint: string }[] = [
  { id: 'glass', label: 'Стекло', hint: 'Размытие рабочего стола за окном. Не гаснет, когда окно не в фокусе' },
  { id: 'acrylic', label: 'Акрил', hint: 'Системный акрил Windows 11: без фокуса становится сплошным' },
  { id: 'mica', label: 'Mica', hint: 'Мягкий оттенок обоев, почти непрозрачный' },
  { id: 'tabbed', label: 'Mica Alt', hint: 'Более насыщенный вариант Mica' },
  { id: 'none', label: 'Нет', hint: 'Сплошной фон, минимальная нагрузка на видеокарту' },
];

const THEMES: [ThemeMode, string][] = [
  ['dark', 'Тёмная'],
  ['light', 'Светлая'],
  ['system', 'Как в Windows'],
];

const CONTRASTS: [ContrastLevel, string][] = [
  ['standard', 'Стандартный'],
  ['medium', 'Средний'],
  ['high', 'Высокий'],
];
const CONTRAST_HINT: Record<ContrastLevel, string> = {
  standard: 'Тоны ролей по умолчанию Material 3',
  medium: 'Текст и акценты темнее (или светлее) фона заметнее',
  high: 'Максимальная читаемость: для яркого солнца и слабого зрения',
};

const CORNERS: [SettingsValues['cornerRadius'], string][] = [
  ['small', 'Строже'],
  ['medium', 'Как в M3'],
  ['large', 'Мягче'],
];
const TEXT_SCALES: [SettingsValues['textScale'], string][] = [
  ['small', 'Мельче'],
  ['default', 'Обычный'],
  ['large', 'Крупнее'],
  ['xlarge', 'Крупный'],
];
const MOTIONS: [SettingsValues['motionStyle'], string][] = [
  ['standard', 'Стандартное'],
  ['spring', 'Пружинное'],
  ['minimal', 'Минимум'],
];
const MOTION_HINT: Record<SettingsValues['motionStyle'], string> = {
  standard: 'Кривые Material 3: плавно и быстро',
  spring: 'Material 3 Expressive: элементы двигаются на пружинах, с лёгким перелётом',
  minimal: 'Почти без анимаций: для слабых ПК и тех, кого укачивает',
};

/** Мини-превью схемы: основной цвет, контейнеры и поверхности. */
function StylePreview({ seed, style, dark, contrast }: { seed: string; style: SchemeStyle; dark: boolean; contrast: ContrastLevel }) {
  const sc = useMemo(() => schemeFromSeed(seed, dark, style, contrast), [seed, dark, style, contrast]);
  return (
    <span className="scheme-card__preview" style={{ background: sc['surface-container-low'] }} aria-hidden>
      <i className="scheme-card__dot" style={{ background: sc.primary }} />
      <i className="scheme-card__bar" style={{ background: sc['on-surface-variant'], opacity: 0.6 }} />
      <i className="scheme-card__bar scheme-card__bar--short" style={{ background: sc['outline-variant'] }} />
      <span className="scheme-card__chips">
        <i style={{ background: sc['primary-container'] }} />
        <i style={{ background: sc['secondary-container'] }} />
        <i style={{ background: sc['tertiary-container'] }} />
        <i style={{ background: sc.tertiary }} />
      </span>
    </span>
  );
}

export function AppearanceGroup() {
  const s = useSettings();
  const effective = useEffectiveTheme(s.theme);
  const liveSeed = useUi((u) => u.seed);
  const current = BACKDROPS.find((b) => b.id === s.backdrop) ?? BACKDROPS[0];
  const opacity = Math.round(s.surfaceOpacity * 100);
  const seed = s.seedColor.toLowerCase();
  const previewSeed = s.dynamicAccent ? liveSeed || s.seedColor : s.seedColor;
  const style = SCHEME_STYLES.find((x) => x.id === s.materialStyle) ?? SCHEME_STYLES[0];

  return (
    <Group icon={<Palette size={20} />} title="Оформление" subtitle="Material You: цвет, форма и движение по канону Material 3">
      <Row label="Тема" description={s.theme === 'system' ? `Сейчас в Windows: ${effective === 'dark' ? 'тёмная' : 'светлая'}` : undefined}>
        <Segmented label="Тема" value={s.theme} options={THEMES} onChange={(v) => s.update({ theme: v })} />
      </Row>
      <Switch
        checked={s.dynamicAccent}
        onChange={(v) => s.update({ dynamicAccent: v })}
        label="Динамический цвет"
        description="Палитра интерфейса строится из обложки текущего трека (Material You)"
      />
      <Row label={s.dynamicAccent ? 'Цвет, когда ничего не играет' : 'Основной цвет'} stacked>
        <div className="seed-row">
          {SEED_PRESETS.map((p) => {
            const on = seed === p.color.toLowerCase();
            return (
              <button
                key={p.color}
                className={`seed ${on ? 'seed--on' : ''}`}
                style={{ '--seed': p.color } as CSSProperties}
                title={p.name}
                aria-label={p.name}
                aria-pressed={on}
                onClick={() => s.update({ seedColor: p.color })}
              >
                {on && <Check size={16} />}
              </button>
            );
          })}
          <label className="seed seed--custom" title="Свой цвет">
            <input type="color" value={s.seedColor} onChange={(e) => s.update({ seedColor: e.target.value })} aria-label="Свой цвет" />
          </label>
        </div>
      </Row>
      <Row
        label="Стиль палитры"
        description={`${style.label}: ${style.hint.toLowerCase()}. Превью из ${s.dynamicAccent ? 'текущей обложки' : 'выбранного цвета'}`}
        stacked
      >
        <div className="scheme-grid" role="radiogroup" aria-label="Стиль палитры">
          {SCHEME_STYLES.map((x) => {
            const on = x.id === s.materialStyle;
            return (
              <button
                key={x.id}
                role="radio"
                aria-checked={on}
                className={`scheme-card ${on ? 'is-active' : ''}`}
                onClick={() => s.update({ materialStyle: x.id })}
                title={x.hint}
              >
                <StylePreview seed={previewSeed} style={x.id} dark={effective === 'dark'} contrast={s.contrastLevel} />
                <span className="scheme-card__label">{x.label}</span>
                <span className="scheme-card__hint">{x.hint}</span>
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Контраст" description={CONTRAST_HINT[s.contrastLevel]}>
        <Segmented label="Контраст" value={s.contrastLevel} options={CONTRASTS} onChange={(v) => s.update({ contrastLevel: v })} />
      </Row>
      <Row label="Форма" description="Шкала скруглений Material 3: от строгих углов до мягких">
        <Segmented label="Форма" value={s.cornerRadius} options={CORNERS} onChange={(v) => s.update({ cornerRadius: v })} />
      </Row>
      <Row label="Размер текста" description="Вся типографическая шкала M3 меняется пропорционально">
        <Segmented label="Размер текста" value={s.textScale} options={TEXT_SCALES} onChange={(v) => s.update({ textScale: v })} />
      </Row>
      <Row label="Движение" description={MOTION_HINT[s.motionStyle]}>
        <Segmented label="Движение" value={s.motionStyle} options={MOTIONS} onChange={(v) => s.update({ motionStyle: v })} />
      </Row>
      <Switch
        checked={s.compactMode}
        onChange={(v) => s.update({ compactMode: v })}
        label="Компактный режим"
        description="Ниже строки треков, плотнее сетки и панели: больше помещается на экран"
      />
      <Row label="Фон окна" description={current.hint} stacked>
        <Segmented
          label="Фон окна"
          value={s.backdrop}
          options={BACKDROPS.map((b) => [b.id, b.label] as [BackdropEffect, string])}
          onChange={(v) => s.update({ backdrop: v })}
        />
      </Row>
      <Row label="Плотность панелей" description="Насколько сквозь интерфейс виден рабочий стол">
        <span className="range-field">
          <input
            type="range"
            className="range"
            min={15}
            max={95}
            step={5}
            value={opacity}
            disabled={s.reduceTransparency || s.backdrop === 'none'}
            onChange={(e) => s.update({ surfaceOpacity: Number(e.target.value) / 100 })}
            style={{ '--fill': `${((opacity - 15) / 80) * 100}%` } as CSSProperties}
            aria-label="Плотность панелей"
          />
          <span className="range-field__value">{opacity}%</span>
        </span>
      </Row>
      <Switch
        checked={s.reduceTransparency}
        onChange={(v) => s.update({ reduceTransparency: v })}
        label="Без прозрачности"
        description="Сплошной фон вместо стекла: меньше нагрузка на видеокарту"
      />
      <Switch
        checked={s.showVisualizer}
        onChange={(v) => s.update({ showVisualizer: v })}
        label="Визуализатор"
        description="Спектр на экране «Сейчас играет»"
      />
    </Group>
  );
}

export function LyricsGroup() {
  const s = useSettings();
  const [custom, setCustom] = useState(() => countOverrides());
  return (
    <Group icon={<MicVocal size={20} />} title="Тексты песен" subtitle="LRCLIB, NetEase, YouTube Music и Genius">
      <Switch
        checked={s.lyricsAutoSync}
        onChange={(v) => s.update({ lyricsAutoSync: v })}
        label="Автосинхронизация"
        description="Если у текста нет таймкодов, Frost сам расставит их по голосу в треке"
      />
      <Switch
        checked={s.lyricsKaraoke}
        onChange={(v) => s.update({ lyricsKaraoke: v })}
        label="Караоке-заливка"
        description="Строка заполняется цветом по мере пения: по словам, если источник даёт пословную разметку"
      />
      <Row
        label="Мои правки текстов"
        description={custom ? `Треков с выбранным источником, сдвигом или своей синхронизацией: ${custom}` : 'Пока нет: источник, сдвиг и синхронизация задаются в панели текста'}
      >
        <button
          className="btn btn--outlined btn--sm"
          disabled={!custom}
          onClick={() => {
            clearAllOverrides();
            setCustom(0);
            toast('Настройки текстов сброшены');
          }}
        >
          Сбросить
        </button>
      </Row>
    </Group>
  );
}
