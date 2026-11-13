/**
 * DSH 花费 — Client half.
 *
 * A composer-dock pill beside the built-in activity/usage pills. The value is
 * the `deepseekCost` session projection (computed by the Host half); this
 * module only formats and renders it. Clicking the pill opens a portaled
 * details dialog anchored above it.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-cost-meter',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const NS = 'dshCost';

    const ZH = {
      label: '≈{amount}',
      title: 'DSH 花费（估算）',
      aria: '本会话估算花费 {amount}，打开明细',
      'row.cacheHit': '缓存命中输入',
      'row.cacheMiss': '缓存未命中输入',
      'row.cacheWrite': '缓存写入输入',
      'row.output': '输出',
      'row.peak': '高峰时段',
      'row.offPeak': '空闲时段',
      'row.model': '模型',
      'row.pricePeak': '高峰单价',
      'row.priceOffPeak': '空闲单价',
      'row.priceDate': '价目变更',
      'row.priceChecked': '最近核对',
      price: '命中 ¥{hit} · 未命中 ¥{miss} · 输出 ¥{output} / 百万',
      'note.estimate': '按 DeepSeek 官方人民币价目估算，仅供预算参考。',
      'note.window': '高峰为北京时间工作日 9:00–12:00、14:00–18:00；未剔除法定节假日，也不含子代理会话及搜索/抓取费用。',
      'note.unknownModel': '该模型暂无价目，按 deepseek-flash 价格估算。',
    };

    const EN = {
      label: '≈{amount}',
      title: 'DSH cost (estimate)',
      aria: 'Estimated cost of this session: {amount}. Open details.',
      'row.cacheHit': 'Cached input',
      'row.cacheMiss': 'Uncached input',
      'row.cacheWrite': 'Cache write input',
      'row.output': 'Output',
      'row.peak': 'Peak hours',
      'row.offPeak': 'Off-peak hours',
      'row.model': 'Model',
      'row.pricePeak': 'Peak price',
      'row.priceOffPeak': 'Off-peak price',
      'row.priceDate': 'Price changed',
      'row.priceChecked': 'Last checked',
      price: 'hit ¥{hit} · miss ¥{miss} · output ¥{output} / 1M',
      'note.estimate': 'Estimated from the official DeepSeek CNY price list; for budgeting only.',
      'note.window': 'Peak is Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00; public holidays, subagent sessions, and Search/Fetch fees are not included.',
      'note.unknownModel': 'No price list for this model; priced as deepseek-flash.',
    };

    const CSS = [
      '.dcm-anchor{display:inline-flex;min-width:0;align-items:center}',
      '.dcm-pill{box-sizing:border-box;min-width:0;height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-secondary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(24px + var(--dsh-content-font-delta,0px));font-variant-numeric:tabular-nums;white-space:nowrap;cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:6px 8px;display:inline-flex;font-family:inherit}',
      '.dcm-pill:hover,.dcm-pill[aria-expanded="true"]{background:color-mix(in srgb, var(--dsw-alias-label-secondary) 8%, transparent)}',
      '.dcm-pill:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:-2px}',
      '.dcm-pill svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));flex:none}',
      '.dcm-panel{z-index:1100;box-sizing:border-box;position:fixed;width:max-content;min-width:min(300px,calc(100vw - 24px));max-width:min(440px,calc(100vw - 24px));border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.14));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(12px));color:var(--dsw-alias-label-secondary);cursor:default;padding:16px;font-family:inherit;font-size:12px;line-height:18px}',
      '.dcm-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:8px;color:var(--dsw-alias-label-primary);font-weight:500}',
      '.dcm-headLabel{display:inline-flex;align-items:center;gap:6px;min-width:0}',
      '.dcm-headLabel svg{flex:none;width:14px;height:14px}',
      '.dcm-headValue{font-variant-numeric:tabular-nums}',
      '.dcm-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 0 10px}',
      '.dcm-rule+.dcm-rule{margin-top:10px}',
      '.dcm-rows{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0}',
      '.dcm-rows dt,.dcm-rows dd{min-width:0;margin:0}',
      '.dcm-rows dt{color:var(--dsw-alias-label-secondary)}',
      '.dcm-rows dd{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;text-align:right}',
      '.dcm-note{margin:10px 0 0;color:var(--dsw-alias-label-secondary)}',
      '.dcm-note+.dcm-note{margin-top:6px}',
    ].join('');

    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 };
    const PANEL_GAP = 8;
    const PANEL_MARGIN = 12;

    function IconCost() {
      return h('svg', { viewBox: '0 0 16 16', width: 15, height: 15, 'aria-hidden': true },
        h('circle', { cx: 8, cy: 8, r: 6.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', {
          d: 'M5.6 5.4 8 8.2l2.4-2.8M8 8.2v3M5.9 8.9h4.2M5.9 10.6h4.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }));
    }

    /**
     * Compact token count.
     * @param {number} value - token count.
     * @returns {string} display text.
     */
    function formatTokens(value) {
      const count = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
      if (count < 1000) return String(Math.round(count));
      if (count < 1000000) return `${(count / 1000).toFixed(1)}K`;
      return `${(count / 1000000).toFixed(2)}M`;
    }

    /**
     * Compact CNY amount: 4 decimals below one cent, 3 below one yuan, else 2.
     * @param {number} value - CNY amount.
     * @returns {string} display text.
     */
    function formatYuan(value) {
      const amount = typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
      if (amount === 0) return '0.00';
      if (amount < 0.01) return amount.toFixed(4);
      if (amount < 1) return amount.toFixed(3);
      if (amount < 100) return amount.toFixed(2);
      return amount.toFixed(1);
    }

    /**
     * One trigger-anchored dialog seat: open state, viewport-clamped placement,
     * Escape/outside-click close.
     * @returns {{open: boolean, setOpen: Function, rootRef: object, panelRef: object, pos: object|null}} the seat.
     */
    function useDialog() {
      const [open, setOpen] = React.useState(false);
      const [pos, setPos] = React.useState(null);
      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);

      React.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        const place = () => {
          const anchor = rootRef.current;
          const panel = panelRef.current;
          if (!anchor || !panel) return;
          const box = anchor.getBoundingClientRect();
          const width = panel.offsetWidth;
          const height = panel.offsetHeight;
          const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
          const left = Math.min(Math.max(box.left + box.width / 2 - width / 2, PANEL_MARGIN), maxLeft);
          let top = box.top - PANEL_GAP - height;
          if (top < PANEL_MARGIN) top = Math.min(box.bottom + PANEL_GAP, window.innerHeight - height - PANEL_MARGIN);
          setPos({ left: Math.round(left), top: Math.round(top) });
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
      }, [open]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        const onPointer = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          if (rootRef.current && rootRef.current.contains(target)) return;
          if (panelRef.current && panelRef.current.contains(target)) return;
          setOpen(false);
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('click', onPointer, true);
        return () => {
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('click', onPointer, true);
        };
      }, [open]);

      return { open, setOpen, rootRef, panelRef, pos };
    }

    /**
     * Append one label/value row to a definition list.
     * @param {Array} rows - accumulated React children.
     * @param {string} label - row label text.
     * @param {string} value - row value text.
     */
    function pushRow(rows, label, value) {
      rows.push(h('dt', { key: `dt-${rows.length}` }, label));
      rows.push(h('dd', { key: `dd-${rows.length}` }, value));
    }

    /**
     * Unit-price line for one tariff window.
     * @param {object} t - locale seat.
     * @param {{cacheHit: number, cacheMiss: number, output: number}} price - CNY per 1M tokens.
     * @returns {string} display text.
     */
    function priceLine(t, price) {
      return t('price', { hit: price.cacheHit, miss: price.cacheMiss, output: price.output });
    }

    /**
     * Composer-dock pill and its details dialog.
     * @param {object} props - slot props (`useProjection`, `t`).
     * @returns {object|null} pill subtree, or null before the session bills anything.
     */
    function CostPill({ useProjection, t }) {
      const cost = useProjection('deepseekCost');
      const { open, setOpen, rootRef, panelRef, pos } = useDialog();
      if (cost === undefined || cost === null) return null;
      const tokens = cost.tokens || {};
      const billed = (tokens.uncachedInputTokens || 0) + (tokens.cacheReadTokens || 0)
        + (tokens.cacheWriteTokens || 0) + (tokens.outputTokens || 0);
      if (!(billed > 0)) return null;
      const amount = `¥${formatYuan(cost.totalCost)}`;
      const label = t('label', { amount });

      const rows = [];
      pushRow(rows, t('row.cacheHit'), formatTokens(tokens.cacheReadTokens));
      pushRow(rows, t('row.cacheMiss'), formatTokens(tokens.uncachedInputTokens));
      if ((tokens.cacheWriteTokens || 0) > 0) pushRow(rows, t('row.cacheWrite'), formatTokens(tokens.cacheWriteTokens));
      pushRow(rows, t('row.output'), formatTokens(tokens.outputTokens));
      pushRow(rows, t('row.peak'), `¥${formatYuan(cost.peakCost)}`);
      pushRow(rows, t('row.offPeak'), `¥${formatYuan(cost.offPeakCost)}`);

      const priceRows = [];
      const prices = cost.prices;
      if (prices !== undefined && prices !== null && prices.peak !== undefined && prices.offPeak !== undefined) {
        pushRow(priceRows, t('row.pricePeak'), priceLine(t, prices.peak));
        pushRow(priceRows, t('row.priceOffPeak'), priceLine(t, prices.offPeak));
      }
      pushRow(priceRows, t('row.model'), cost.model || '—');
      if (typeof cost.priceUpdatedAt === 'string') pushRow(priceRows, t('row.priceDate'), cost.priceUpdatedAt);
      if (typeof cost.priceCheckedAt === 'string') pushRow(priceRows, t('row.priceChecked'), cost.priceCheckedAt);

      return h('span', { ref: rootRef, className: 'dcm-anchor', 'data-composer-stat': 'cost' },
        h('button', {
          type: 'button',
          className: 'dcm-pill',
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': t('aria', { amount }),
          title: t('title'),
          onClick: () => setOpen(!open),
        }, IconCost(), h('span', null, label)),
        open ? ReactDOM.createPortal(
          h('div', {
            ref: panelRef,
            role: 'dialog',
            'aria-label': t('title'),
            className: 'dcm-panel',
            style: pos === null ? MEASURE_STYLE : pos,
          },
            h('div', { className: 'dcm-head' },
              h('span', { className: 'dcm-headLabel' }, IconCost(), t('title')),
              h('span', { className: 'dcm-headValue' }, label)),
            h('div', { className: 'dcm-rule' }),
            h('dl', { className: 'dcm-rows' }, rows),
            h('div', { className: 'dcm-rule' }),
            h('dl', { className: 'dcm-rows' }, priceRows),
            h('p', { className: 'dcm-note' }, t('note.estimate')),
            cost.modelKnown === false ? h('p', { className: 'dcm-note' }, t('note.unknownModel')) : null,
            h('p', { className: 'dcm-note' }, t('note.window'))),
          document.body,
        ) : null,
      );
    }

    const CSS_MARKER = 'dsh-cost-meter';

    /**
     * Client plugin body: styles, dictionaries, and the composer-dock pill.
     * @param {object} ctx - Client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = CSS_MARKER;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'dsh-cost-meter: styles');
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-cost-meter: dictionaries');
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'cost',
        order: 2,
        locale: NS,
      }, CostPill));
    }

    return { inject: ['slots', 'locale'], apply };
  },
});
