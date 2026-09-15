// dsh-almazom-approve-escalate — client bundle.
//
// Bundle format: `window.__ModuleLoader__.load({ id, factory })` — the lazy-CJS
// table contract consumed by dsh-web-app. The factory requires only `react`
// (the host's shared client module table), so this file stays self-contained:
// no relative require, no JSX, no build step.
//
// What it adds: the approval card's detail cell (conversation.approval.detail —
// the documented in-card plugin surface) renders the correlated tool call's
// command text plus an "Approve & escalate" action. One click (1) dispatches
// `/permission <preset>` on the live session through the sessions face's
// command API, (2) verifies the switch actually landed via the permissions
// projection, and only then (3) answers the pending approval 'allowed-once'.
// Both are actions the operator could perform manually — this plugin only
// composes them. No auto-approval, no interception, no telemetry.
//
// Slot ownership note: `conversation.approval.detail` is a single slot — one
// cell winner, and the dynamic-plugin guard assigns its own rank (a passed
// priority is ignored). Registering means REPLACING the shipped ApprovalCommand
// renderer, so this component re-renders the command text itself (information
// parity) on top of the shipped reason headline.

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
    var useEffect = react.useEffect;

    var PLUGIN_ID = 'dsh-almazom-approve-escalate';
    var STYLE_ID = 'dsh-almazom-approve-escalate-style';
    var CONFIG_PATH = '/almazom-approve-escalate/config.json';
    // Operator order 2026-09-15: the button is THE full-access action. Even
    // when the host config fetch fails, the fallback must stay the YOLO mode —
    // never silently downgrade to a weaker preset.
    var DEFAULT_CONFIG = { preset: 'danger-full-access', label: 'Approve & full access' };
    // Presets that disable future approval prompts get an explicit warning.
    var NO_FUTURE_PROMPT_PRESETS = ['danger-full-access'];
    // How long the click flow waits for the permissions projection to reflect
    // the switched preset before declaring the outcome unverifiable.
    var VERIFY_TRIES = 6;
    var VERIFY_DELAY_MS = 300;

    // ── styles ───────────────────────────────────────────────────────────
    // Theme CSS variables instead of literal colors, so both color schemes work.
    var CSS = [
      '.almazom-ae-cell { margin:2px 0; }',
      '.almazom-ae-cmd { font-family:var(--dsw-alias-font-mono, monospace); font-size:12px;',
      '  padding:5px 8px; margin:4px 0; border-radius:6px; white-space:pre-wrap; word-break:break-all;',
      '  background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, transparent));',
      '  border:1px solid var(--dsw-alias-border, transparent); }',
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
      '.almazom-ae-warn { font-size:11.5px; color:var(--dsw-alias-label-critical, var(--dsw-alias-label-secondary, inherit)); font-weight:600; }',
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
    // The app can be root-mounted (direct :3080, tailnet) or served under a
    // path prefix (close-reading.ru/dsh via the tailnet proxy). Derive the app
    // base from the module graph's own load URL so the host-route fetch lands
    // on the same tier the bundle was loaded from; fall back to root.
    function appBase() {
      try {
        var entries = performance.getEntriesByType('resource');
        for (var i = entries.length - 1; i >= 0; i--) {
          var m = String(entries[i].name).match(/^(https?:\/\/[^/]+)(.*?)\/plugins\/\?\?/);
          if (m) return m[1] + m[2];
        }
      } catch (e) { /* performance API unavailable — root fallback below */ }
      return '';
    }
    function loadConfig() {
      if (configPromise === null) {
        configPromise = fetch(appBase() + CONFIG_PATH)
          .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status)); })
          .then(function (data) {
            return {
              preset: typeof data.preset === 'string' && data.preset ? data.preset : DEFAULT_CONFIG.preset,
              label: typeof data.label === 'string' && data.label ? data.label : DEFAULT_CONFIG.label,
              fromHost: true,
            };
          })
          .catch(function () {
            configPromise = null;
            return Object.assign({}, DEFAULT_CONFIG, { fromHost: false });
          });
      }
      return configPromise;
    }

    // ── escalation primitives (pure enough to test through __test) ──────
    // Escalation goes through the sessions face's command API — the same write
    // path the shipped /permission picker uses.
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
        // `matched` only says a handler consumed the line — the handler's own
        // error outcome (e.g. unknown preset) is discarded by the transport,
        // so the switch is verified against the projection below.
        if (result && result.value && result.value.matched === false) {
          throw new Error('the host offers no /permission command');
        }
        return live;
      });
    }

    // Poll the permissions projection until it reflects the target preset.
    function verifyPreset(live, preset, tries, delayMs) {
      function attempt(remaining) {
        var snapshot;
        try {
          snapshot = live.projections.faceOf('permissions').getSnapshot();
        } catch (_e) { snapshot = undefined; }
        if (snapshot && snapshot.currentValue === preset) return Promise.resolve(true);
        if (remaining <= 0) return Promise.resolve(false);
        return new Promise(function (resolve) { setTimeout(resolve, delayMs); })
          .then(function () { return attempt(remaining - 1); });
      }
      return attempt(tries);
    }

    function answerAllowedOnce(pending) {
      if (pending && typeof pending.answer === 'function') {
        // Settling an already-settled approval rejects — the caller surfaces it.
        return pending.answer('allowed-once');
      }
      return Promise.reject(new Error('approval answer is unavailable'));
    }

    // ── command preview (parity with the shipped ApprovalCommand) ───────
    // Same extraction the shipped detail renderer performs: the chat snapshot's
    // tool-call node correlated by callId; falls back to a compact raw-args
    // preview for tools without a `command` argument (e.g. write).
    function compactArgs(argsRaw) {
      if (typeof argsRaw !== 'string' || argsRaw.length === 0) return undefined;
      var line = argsRaw.replace(/\s+/g, ' ').trim();
      return line.length > 160 ? line.slice(0, 157) + '…' : line;
    }

    function chatCommandPreview(useChat, callId) {
      if (typeof useChat !== 'function') return undefined;
      try {
        return useChat(function (snapshot) {
          var nodes = snapshot && snapshot.nodes;
          if (!nodes || typeof nodes.values !== 'function') return undefined;
          for (var node of nodes.values()) {
            var root = node && node.kind === 'tool-call' && node.data ? node.data.root : undefined;
            if (root !== undefined && root.callId === callId && !('kind' in root)) {
              try {
                var args = JSON.parse(root.argsRaw);
                if (typeof args.command === 'string') return args.command;
              } catch (_e) { /* fall through to raw preview */ }
              return compactArgs(root.argsRaw);
            }
          }
          return undefined;
        });
      } catch (_e) { return undefined; }
    }

    // ── the detail renderer ──────────────────────────────────────────────
    // Owner props: { callId }. Standard seats used: sessionId,
    // useSessionPendingInteraction (selector over the per-session map),
    // useChat (chat snapshot for the command preview).
    function ApproveEscalate(props) {
      var ctx = props.__ctx;
      var callId = props.callId;
      var sessionId = props.sessionId;
      // Hooks are called unconditionally; seat absence degrades to no-ops.
      var usePending = typeof props.useSessionPendingInteraction === 'function'
        ? props.useSessionPendingInteraction
        : function () { return undefined; };
      var useChat = typeof props.useChat === 'function' ? props.useChat : undefined;

      var configState = useState(Object.assign({}, DEFAULT_CONFIG, { fromHost: false }));
      var config = configState[0];
      var busyState = useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var noteState = useState('');
      var note = noteState[0];
      var setNote = noteState[1];

      useEffect(function () {
        var alive = true;
        loadConfig().then(function (cfg) { if (alive) configState[1](cfg); });
        return function () { alive = false; };
      }, []);

      var pending = usePending(function (map) {
        return map && typeof map.get === 'function' ? map.get(sessionId) : undefined;
      });
      var canAnswer = !!(pending && typeof pending.answer === 'function');
      // Only act on the interaction this detail belongs to.
      var ownsCall = !!(pending && (pending.callId === undefined || pending.callId === callId));

      var commandPreview = callId !== undefined ? chatCommandPreview(useChat, callId) : undefined;

      var onClick = useCallback(function () {
        if (busy) return;
        setBusy(true);
        setNote('');
        var live;
        escalate(ctx, sessionId, config.preset)
          .then(function (session) { live = session; return verifyPreset(live, config.preset, VERIFY_TRIES, VERIFY_DELAY_MS); })
          .then(function (verified) {
            if (!verified) {
              setNote('Could not confirm the preset switch — the request is NOT answered. Use Allow once.');
              return undefined;
            }
            if (!canAnswer || !ownsCall) {
              setNote('Preset "' + config.preset + '" applied — confirm the request with Allow once.');
              return undefined;
            }
            // The approval answer itself may reject (aborted / settled in the
            // meantime) — surface that instead of failing silently.
            return Promise.resolve(answerAllowedOnce(pending)).then(function () {
              setNote('');
            }, function (err) {
              setNote('Answer failed: ' + String(err && err.message ? err.message : err));
            });
          })
          .catch(function (err) {
            // Escalation failure never answers the request — surface and stop.
            setNote(String(err && err.message ? err.message : err));
          })
          .then(function () { setBusy(false); });
      }, [busy, canAnswer, ownsCall, pending, config.preset, ctx, sessionId]);

      var hint = config.preset === 'danger-full-access'
        ? 'switches this session to full access — sandbox off, no further approval prompts' +
          (config.fromHost ? '' : ' (default — config unavailable)')
        : 'also switches this session to ' + config.preset +
          (config.fromHost ? '' : ' (default — config unavailable)');
      var warning = NO_FUTURE_PROMPT_PRESETS.indexOf(config.preset) !== -1
        ? '⚠ this preset disables future approval prompts'
        : undefined;

      return createElement('div', { className: 'almazom-ae-cell' },
        commandPreview !== undefined
          ? createElement('div', { className: 'almazom-ae-cmd' }, commandPreview)
          : null,
        createElement('div', { className: 'almazom-ae-row' },
          createElement('button', {
            className: 'almazom-ae-btn',
            type: 'button',
            disabled: busy || !ownsCall,
            title: 'Approves this request and switches the session to "' + config.preset + '"',
            onClick: onClick,
          }, busy ? 'Escalating…' : config.label),
          createElement('span', { className: 'almazom-ae-hint' }, hint),
        ),
        warning ? createElement('div', { className: 'almazom-ae-warn' }, warning) : null,
        note ? createElement('div', { className: 'almazom-ae-note' }, note) : null,
      );
    }

    // ── plugin apply ─────────────────────────────────────────────────────
    function apply(ctx) {
      insertStyles();
      var disposeSlot = ctx.slots.inject('conversation.approval.detail', function () {
        return ctx.slots.register(
          // Raw client-modules loads bypass the dynamic-runner guard, so no
          // page-local rank is assigned: without an explicit priority this
          // registration lands on 0 and races the shipped ApprovalCommand's
          // own 0 registration — the loser fails the whole ui-chat plugin.
          // -10 wins the single-slot election (lowest renders) deterministically.
          { name: 'conversation.approval.detail', priority: -10 },
          // Inject the plugin context through props so the component stays a
          // plain function the slot framework can call with owner + seats.
          function (ownerProps) {
            return ApproveEscalate(Object.assign({}, ownerProps, { __ctx: ctx }));
          },
        );
      });
      // /yolo: composer slash command — switch this session to full access
      // through the same escalation path as the card button. Documented
      // client seam: ctx.commandUi.register(CommandContribution).
      ctx.inject(['commandUi'], function (scope) {
        var commandUi = scope.get('commandUi');
        scope.effect(function () {
          return commandUi.register({
            name: 'yolo',
            label: function () { return 'YOLO — full access'; },
            description: function () {
              return 'Switch this session to full access: sandbox off, no further approval prompts.';
            },
            available: function () { return true; },
            ui: {
              kind: 'action',
              run: function (session) {
                return escalate(ctx, session.sessionId, 'danger-full-access')
                  .then(function (live) {
                    return verifyPreset(live, 'danger-full-access', VERIFY_TRIES, VERIFY_DELAY_MS);
                  });
              },
            },
          });
        }, 'almazom-approve-escalate: /yolo contribution');
      });
      return function () {
        if (typeof disposeSlot === 'function') disposeSlot();
        removeStyles();
      };
    }

    exports.apply = apply;
    // Service declarations: slots for the registration, sessions for the
    // command dispatch. Both are documented client services.
    exports.inject = ['slots', 'sessions'];

    // Test seam: behavior helpers for direct assertions without a browser.
    exports.__test = {
      loadConfig: loadConfig,
      escalate: escalate,
      verifyPreset: verifyPreset,
      answerAllowedOnce: answerAllowedOnce,
      compactArgs: compactArgs,
      DEFAULT_CONFIG: DEFAULT_CONFIG,
    };

    return module.exports;
  },
});
