// dsh-almazom-approve-escalate — client bundle.
//
// Bundle format: `window.__ModuleLoader__.load({ id, factory })` — the lazy-CJS
// table contract consumed by dsh-web-app. The factory requires only `react`
// (the host's shared client module table), so this file stays self-contained:
// no relative require, no JSX, no build step.
//
// What it adds: the approval card's detail slot (conversation.approval.detail —
// the one officially documented in-card plugin surface) renders an
// "Approve & escalate" action. One click (1) dispatches `/permission <preset>`
// on the live session through the sessions face's command API and (2) answers
// the pending approval 'allowed-once' when the pending-interaction seat exposes
// an answer method. Both are actions the operator could perform manually — this
// plugin only composes them. No auto-approval, no interception, no telemetry.
//
// Graceful degradation: every seat use is feature-detected; a missing seat
// renders a hint instead of failing the card.

window.__ModuleLoader__.load({
  id: 'dsh-almazom-approve-escalate',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // ── react (defensive default interop) ────────────────────────────────
    var reactModule = require('react');
    var react = reactModule && reactModule.default ? reactModule.default : reactModule;
    var createElement = react.createElement;
    var useState = react.useState;
    var useCallback = react.useCallback;

    var PLUGIN_ID = 'dsh-almazom-approve-escalate';
    var STYLE_ID = 'dsh-almazom-approve-escalate-style';
    var CONFIG_PATH = '/almazom-approve-escalate/config.json';
    var DEFAULT_CONFIG = { preset: 'workspace-write', label: 'Approve & escalate' };

    // ── styles ───────────────────────────────────────────────────────────
    // Theme CSS variables instead of literal colors, so both color schemes work.
    var CSS = [
      '.almazom-ae-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap;',
      '  margin:6px 0 2px 0; }',
      '.almazom-ae-btn { display:inline-flex; align-items:center; gap:6px; cursor:pointer;',
      '  border:1px solid var(--dsw-alias-border-strong, var(--dsw-alias-border, currentColor));',
      '  border-radius:8px; padding:4px 10px; font-size:12.5px; line-height:1.4;',
      '  background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, transparent));',
      '  color:var(--dsw-alias-label-primary, inherit); }',
      '.almazom-ae-btn:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, transparent)); }',
      '.almazom-ae-btn:disabled { opacity:0.55; cursor:default; }',
      '.almazom-ae-hint { font-size:11.5px; opacity:0.7; }',
      '.almazom-ae-note { font-size:11.5px; color:var(--dsw-alias-label-secondary, inherit); opacity:0.85; }',
    ].join('\n');

    function insertStyles() {
      if (typeof document === 'undefined') return;
      var existing = document.getElementById(STYLE_ID);
      if (existing) return;
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-' + PLUGIN_ID, '');
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    function removeStyles() {
      if (typeof document === 'undefined') return;
      var existing = document.getElementById(STYLE_ID);
      if (existing) existing.remove();
    }

    // ── config (fetched once from the host face's WebRoute) ─────────────
    var configPromise = null;
    function loadConfig() {
      if (configPromise === null) {
        configPromise = fetch(CONFIG_PATH)
          .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); })
          .then(function (data) {
            return {
              preset: typeof data.preset === 'string' && data.preset ? data.preset : DEFAULT_CONFIG.preset,
              label: typeof data.label === 'string' && data.label ? data.label : DEFAULT_CONFIG.label,
            };
          })
          .catch(function () { return DEFAULT_CONFIG; });
      }
      return configPromise;
    }

    // ── escalation + answer ──────────────────────────────────────────────
    // Escalation goes through the sessions face's command API — the same write
    // path the shipped /permission picker uses; the command applies the preset
    // to the LIVE session (approval policy included).
    function escalate(ctx, sessionId, preset) {
      var sessions = ctx.get ? ctx.get('sessions') : (ctx.sessions || undefined);
      if (sessions === undefined || typeof sessions.binding !== 'function') {
        return Promise.reject(new Error('sessions service unavailable'));
      }
      var binding = typeof sessionId === 'string' ? sessions.binding(sessionId) : undefined;
      var live = binding && binding.session;
      if (live === undefined || typeof live.command !== 'function') {
        return Promise.reject(new Error('session is not materialized yet'));
      }
      return live.command('/permission ' + preset).then(function (result) {
        if (result && result.ok === false) {
          throw new Error('permission switch failed: ' + result.error.code + ': ' + result.error.message);
        }
        if (result && result.value && result.value.matched === false) {
          throw new Error('the host offers no /permission command');
        }
      });
    }

    function answerAllowedOnce(pending) {
      if (pending && typeof pending.answer === 'function') {
        pending.answer('allowed-once');
        return true;
      }
      return false;
    }

    // ── the detail renderer ──────────────────────────────────────────────
    // Owner props: { callId }. Standard seats used: sessionId,
    // useSessionPendingInteraction (selector over the per-session map).
    function ApproveEscalate(props) {
      var ctx = props.__ctx;
      var callId = props.callId;
      var sessionId = props.sessionId;
      var usePending = props.useSessionPendingInteraction;

      var configState = useState(DEFAULT_CONFIG);
      var config = configState[0];
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var noteState = useState('');
      var note = noteState[0];
      var setNote = noteState[1];

      var useEffect = react.useEffect;
      useEffect(function () {
        var alive = true;
        loadConfig().then(function (cfg) { if (alive) configState[1](cfg); });
        return function () { alive = false; };
      }, []);

      var pending = undefined;
      if (typeof usePending === 'function' && sessionId !== undefined) {
        try {
          var snapshot = usePending(function (map) {
            return map && typeof map.get === 'function' ? map.get(sessionId) : undefined;
          });
          pending = snapshot;
        } catch (_e) { pending = undefined; }
      }
      var canAnswer = !!(pending && typeof pending.answer === 'function');
      // Only act on the interaction this detail belongs to.
      var ownsCall = !!(pending && (pending.callId === undefined || pending.callId === callId));

      var onClick = useCallback(function () {
        if (busy) return;
        setBusy(true);
        setNote('');
        escalate(ctx, sessionId, config.preset)
          .then(function () {
            if (!canAnswer || !ownsCall) {
              setNote('Preset "' + config.preset + '" applied — confirm the request with Allow once.');
              return;
            }
            return answerAllowedOnce(pending);
          })
          .catch(function (err) {
            // Escalation or settlement failure never answers the request — surface it.
            setNote(String(err && err.message ? err.message : err));
          })
          .then(function () { setBusy(false); });
      }, [busy, canAnswer, ownsCall, pending, config.preset, ctx, sessionId]);

      if (!canAnswer) {
        // The pending-interaction seat is absent or shapeless: render nothing
        // actionable so the shipped card stays authoritative.
        return null;
      }

      return createElement('div', null,
        createElement('div', { className: 'almazom-ae-row' },
          createElement('button', {
            className: 'almazom-ae-btn',
            type: 'button',
            disabled: busy || !ownsCall,
            title: 'Approves this request and switches the session to "' + config.preset + '"',
            onClick: onClick,
          }, busy ? 'Escalating…' : config.label),
          createElement('span', { className: 'almazom-ae-hint' },
            'also switches this session to ' + config.preset),
        ),
        note ? createElement('div', { className: 'almazom-ae-note' }, note) : null,
      );
    }

    // ── plugin apply ─────────────────────────────────────────────────────
    function apply(ctx) {
      insertStyles();
      ctx.slots.inject('conversation.approval.detail', function () {
        return ctx.slots.register(
          // Raw client-modules loads get no facade-assigned priority: ship an
          // explicit one below the shipped entry (single slot: lowest renders,
          // same-priority second registration throws).
          { name: 'conversation.approval.detail', priority: -10 },
          // Inject the plugin context through props so the component stays a
          // plain function the slot framework can call with owner + seats.
          function (ownerProps) {
            return ApproveEscalate(Object.assign({}, ownerProps, { __ctx: ctx }));
          },
        );
      });
    }

    exports.apply = apply;
    // Service declarations: slots for the registration, sessions for the
    // command dispatch. Both are documented client services.
    exports.inject = ['slots', 'sessions'];

    // Test seam: pure helpers for direct assertions without a browser.
    exports.__test = {
      loadConfig: loadConfig,
      escalate: escalate,
      answerAllowedOnce: answerAllowedOnce,
      DEFAULT_CONFIG: DEFAULT_CONFIG,
    };

    return module.exports;
  },
});
