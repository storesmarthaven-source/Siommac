import { type VNode } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../../overlays/Dialog';
import { Button } from '../../primitives/Button';
import { Badge } from '../../primitives/Badge';
import { Textarea } from '../../forms/inputs';
import { FileInput } from '../../forms/FileInput';
import { Avatar } from '../../people/Avatar';
import { FileTypeIcon, fileTypeIconTypeFromName } from '../../data/FileTypeIcon';
import { LucideIcon } from '../../LucideIcon';
import './aiAssistant.recipe.css';

const DEFAULT_PROMPT = 'Summarize the current roster risks and recommend the next actions.';

export interface AiAssistantProps {
  open: boolean;
  onClose: () => void;
  userName?: string;
  userAvatarSrc?: string | null;
  contextLabel?: string;
}

type GenerationPhase = 'idle' | 'generating' | 'complete';

function AssistantOrb({ size = 'md', active = false }: { size?: 'sm' | 'md' | 'lg'; active?: boolean }): VNode {
  return (
    <span class={`ui-ai-orb ui-ai-orb--${size}${active ? ' is-active' : ''}`} aria-hidden="true">
      <i class="ui-ai-orb__halo" />
      <span class="ui-ai-orb__core" />
      <i class="ui-ai-orb__satellite" />
    </span>
  );
}

function GeneratingIndicator(): VNode {
  return (
    <div class="ui-ai-assistant__generating" role="status" aria-live="polite">
      <AssistantOrb size="md" active />
      <span>
        <strong>Generating Preview Response</strong>
        <small>Reviewing the visible workspace and shaping a structured answer…</small>
      </span>
    </div>
  );
}

function AssistantResponse({ copied, feedback, contextLabel, onCopy, onFeedback }: {
  copied: boolean;
  feedback: 'up' | 'down' | null;
  contextLabel: string;
  onCopy: () => void;
  onFeedback: (value: 'up' | 'down') => void;
}): VNode {
  return (
    <article class="ui-ai-assistant__response">
      <div class="ui-ai-assistant__response-kicker">
        <span class="ui-ai-assistant__brand-icon"><LucideIcon name="MessageCircleMore" size={15} /></span>
        <span>SIOMAC AI</span>
        <Badge tone="neutral" variant="outline" size="sm">Preview</Badge>
      </div>
      <h3>{contextLabel} Summary</h3>
      <p>This interface preview demonstrates how SIOMAC AI can organize workspace context into a concise, reviewable answer.</p>
      <ul>
        <li><strong>Surface priority work.</strong> Bring the most urgent records and unresolved actions into one clear sequence.</li>
        <li><strong>Preserve source context.</strong> Keep every summary connected to the page and records it reviewed.</li>
        <li><strong>Leave the user in control.</strong> Require review before any future backend action can be applied.</li>
      </ul>

      <div class="ui-ai-assistant__sources-head">
        <span>Sources Reviewed</span>
        <span>3 Records</span>
      </div>
      <div class="ui-ai-assistant__sources">
        <div><span class="ui-ai-assistant__source-icon"><LucideIcon name="PanelsTopLeft" size={16} /></span><span><strong>{contextLabel}</strong><small>Current Visible Workspace</small></span><LucideIcon name="ArrowUpRight" size={15} /></div>
        <div><span class="ui-ai-assistant__source-icon"><LucideIcon name="BellRing" size={16} /></span><span><strong>Attention Items</strong><small>Illustrative Preview Data</small></span><Badge tone="warning" size="sm">Review</Badge></div>
        <div><span class="ui-ai-assistant__source-icon"><LucideIcon name="ListChecks" size={16} /></span><span><strong>Recommended Actions</strong><small>Preview Only</small></span><Badge tone="neutral" size="sm">3 Steps</Badge></div>
      </div>

      <div class="ui-ai-assistant__response-actions" aria-label="Preview Response Actions">
        <Button variant="ghost" size="sm" iconLeft={<LucideIcon name={copied ? 'Check' : 'Copy'} size={15} />} onClick={onCopy}>{copied ? 'Copied' : 'Copy'}</Button>
        <Button variant="ghost" size="sm" iconOnly aria-label="Helpful Response" pressed={feedback === 'up'} iconLeft={<LucideIcon name="ThumbsUp" size={15} />} onClick={() => onFeedback('up')} />
        <Button variant="ghost" size="sm" iconOnly aria-label="Unhelpful Response" pressed={feedback === 'down'} iconLeft={<LucideIcon name="ThumbsDown" size={15} />} onClick={() => onFeedback('down')} />
      </div>
    </article>
  );
}

export function AiAssistant({
  open,
  onClose,
  userName = 'User',
  userAvatarSrc,
  contextLabel = 'Current Page',
}: AiAssistantProps): VNode | null {
  const [draft, setDraft] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [phase, setPhase] = useState<GenerationPhase>('idle');
  const [thoughtOpen, setThoughtOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
  const [contextAttached, setContextAttached] = useState(true);
  const generationTimerRef = useRef<number | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);

  const clearGenerationTimer = useCallback((): void => {
    if (generationTimerRef.current !== null) {
      window.clearTimeout(generationTimerRef.current);
      generationTimerRef.current = null;
    }
  }, []);

  function runPreview(nextPrompt: string): void {
    const clean = nextPrompt.trim();
    if (!clean) return;
    clearGenerationTimer();
    setPrompt(clean);
    setDraft('');
    setPhase('generating');
    setCopied(false);
    setFeedback(null);
    setContextAttached(true);
    generationTimerRef.current = window.setTimeout(() => {
      setPhase('complete');
      generationTimerRef.current = null;
    }, 1800);
  }

  const resetConversation = useCallback((): void => {
    clearGenerationTimer();
    setPrompt(null);
    setPhase('idle');
    setDraft('');
    setFiles([]);
    setFileError('');
    setRecording(false);
    setRecordingSeconds(0);
    setThoughtOpen(false);
    setCopied(false);
    setFeedback(null);
    setContextAttached(true);
  }, [clearGenerationTimer]);

  useEffect(() => {
    if (!open) return;
    resetConversation();
    return clearGenerationTimer;
  }, [open, resetConversation, clearGenerationTimer]);

  useEffect(() => {
    if (!recording) return;
    const interval = window.setInterval(() => setRecordingSeconds(value => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    if (!open) return;
    const conversation = conversationRef.current;
    if (conversation && typeof conversation.scrollTo === 'function') {
      conversation.scrollTo({ top: prompt === null ? 0 : conversation.scrollHeight, behavior: prompt === null ? 'auto' : 'smooth' });
    }
  }, [open, phase, prompt]);

  async function copyResponse(): Promise<void> {
    const text = `${contextLabel} Summary: surface priority work, preserve source context, and leave the user in control.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const recordingTime = `${String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:${String(recordingSeconds % 60).padStart(2, '0')}`;
  const firstName = userName.trim().split(/\s+/).find(Boolean) ?? 'There';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      variant="workspace"
      closeOnBackdrop={false}
      class={`ui-ai-assistant${expanded ? ' is-expanded' : ''}`}
    >
      <Dialog.Header
        title="SIOMAC AI Assistant"
        sub="New Conversation"
        icon={<LucideIcon name="MessageCircleMore" size={20} />}
        iconStyle="plain"
        onClose={onClose}
        actions={(
          <div class="ui-ai-assistant__header-actions">
            <Badge tone="neutral" variant="outline" size="sm" icon={<LucideIcon name="LockKeyhole" size={12} />}>Private</Badge>
            <Button variant="ghost" size="sm" iconOnly aria-label="Start New Chat" title="Start New Chat" iconLeft={<LucideIcon name="SquarePen" size={17} />} onClick={resetConversation} />
            <Button variant="ghost" size="sm" iconOnly aria-label={expanded ? 'Restore Assistant Window' : 'Expand Assistant Window'} title={expanded ? 'Restore Window' : 'Expand Window'} pressed={expanded} iconLeft={<LucideIcon name={expanded ? 'Minimize2' : 'Maximize2'} size={17} />} onClick={() => setExpanded(value => !value)} />
          </div>
        )}
      />

      <Dialog.Body class="ui-ai-assistant__body">
        <div class="ui-ai-assistant__conversation" ref={conversationRef}>
          {prompt === null ? (
            <section class="ui-ai-assistant__welcome">
              <div class="ui-ai-assistant__welcome-head">
                <AssistantOrb size="lg" />
                <div>
                  <span class="ui-ai-assistant__eyebrow">Workspace Assistant</span>
                  <h3>Hello {firstName}. How Can I Help?</h3>
                  <p>Ask about the page you are viewing, turn its information into a clear summary, or prepare the next steps.</p>
                </div>
              </div>

              <div class="ui-ai-assistant__prompt-section">
                <div class="ui-ai-assistant__welcome-section-head">
                  <div>
                    <h4>Suggested For This Page</h4>
                    <span>{contextLabel}</span>
                  </div>
                  <LucideIcon name="PanelsTopLeft" size={16} />
                </div>
                <div class="ui-ai-assistant__suggestions">
                  <Button variant="outline" size="sm" iconLeft={<LucideIcon name="ScanSearch" size={16} />} onClick={() => runPreview(DEFAULT_PROMPT)}>Summarize {contextLabel}</Button>
                  <Button variant="outline" size="sm" iconLeft={<LucideIcon name="ShieldCheck" size={16} />} onClick={() => runPreview('Show me the highest-priority items first.')}>Show Priority Items</Button>
                  <Button variant="outline" size="sm" iconLeft={<LucideIcon name="ListChecks" size={16} />} onClick={() => runPreview('Create a concise action plan from the current workspace.')}>Create An Action Plan</Button>
                  <Button variant="outline" size="sm" iconLeft={<LucideIcon name="FileText" size={16} />} onClick={() => runPreview('Draft a professional operational summary.')}>Draft A Summary</Button>
                </div>
              </div>

              <div class="ui-ai-assistant__quick-prompts">
                <div class="ui-ai-assistant__quick-prompts-head">
                  <h4>Quick Prompts</h4>
                  <span>Start With A Common Request</span>
                </div>
                <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="CircleAlert" size={16} />} iconRight={<LucideIcon name="ChevronRight" size={14} />} onClick={() => runPreview('What needs my attention on this page?')}>What Needs My Attention?</Button>
                <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="FileOutput" size={16} />} iconRight={<LucideIcon name="ChevronRight" size={14} />} onClick={() => runPreview('Prepare an executive-ready summary of this workspace.')}>Prepare An Executive Summary</Button>
                <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="Route" size={16} />} iconRight={<LucideIcon name="ChevronRight" size={14} />} onClick={() => runPreview('Recommend the next three actions for this workspace.')}>Recommend The Next Actions</Button>
              </div>
            </section>
          ) : (
            <>
              <div class="ui-ai-assistant__context-line"><Badge tone="info" variant="soft" size="sm" icon={<LucideIcon name="PanelsTopLeft" size={12} />}>{contextLabel}</Badge></div>
              <div class="ui-ai-assistant__user-turn">
                <div class="ui-ai-assistant__user-bubble">{prompt}</div>
                <Avatar name={userName} src={userAvatarSrc} size={30} />
              </div>

              <div class="ui-ai-assistant__trace">
                <button type="button" class="ui-ai-assistant__trace-toggle" aria-expanded={thoughtOpen} onClick={() => setThoughtOpen(value => !value)}>
                  <LucideIcon name="Lightbulb" size={16} />
                  <span>Thought</span>
                  <LucideIcon name={thoughtOpen ? 'ChevronDown' : 'ChevronRight'} size={14} />
                </button>
                {thoughtOpen && <p class="ui-ai-assistant__thought">Identifying the visible planning context, checking the preview records, and organizing the response by urgency.</p>}
                <div class="ui-ai-assistant__viewed"><LucideIcon name="Eye" size={16} /><span>Viewed</span><Badge tone="neutral" size="sm" icon={<LucideIcon name="PanelsTopLeft" size={12} />}>{contextLabel}</Badge></div>
              </div>

              {phase === 'generating' && <GeneratingIndicator />}
              {phase === 'complete' && <AssistantResponse copied={copied} feedback={feedback} contextLabel={contextLabel} onCopy={() => { void copyResponse(); }} onFeedback={value => setFeedback(current => current === value ? null : value)} />}
            </>
          )}
        </div>

        <div class="ui-ai-assistant__composer-wrap">
          {phase === 'complete' && (
            <div class="ui-ai-assistant__followups" aria-label="Suggested Follow-Up Prompts">
              <span class="ui-ai-assistant__followups-handle" aria-hidden="true" />
              <div class="ui-ai-assistant__followups-help"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span><span><kbd>Enter</kbd> to select</span></div>
              <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="ArrowRight" size={15} />} onClick={() => runPreview('Show me the highest-priority items first.')}>Show The Highest-Priority Items</Button>
              <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="ArrowRight" size={15} />} onClick={() => runPreview('Turn this summary into a concise action plan.')}>Turn This Into An Action Plan</Button>
              <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="ArrowRight" size={15} />} onClick={() => runPreview('Which records should I review next?')}>Which Records Should I Review Next?</Button>
            </div>
          )}
          {files.length > 0 && (
            <div class="ui-ai-assistant__attachments" aria-label="Attached Files">
              {files.map((file, index) => (
                <Badge key={`${file.name}-${file.size}`} tone="neutral" variant="outline" size="sm" icon={<FileTypeIcon type={fileTypeIconTypeFromName(file.name)} size={18} />} onRemove={() => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))}>{file.name}</Badge>
              ))}
            </div>
          )}
          {fileError && <div class="ui-ai-assistant__file-error" role="alert"><LucideIcon name="CircleAlert" size={14} />{fileError}</div>}

          <div class={`ui-ai-assistant__composer${recording ? ' is-recording' : ''}`}>
            {contextAttached && !recording && (
              <div class="ui-ai-assistant__composer-context">
                <LucideIcon name="CornerDownRight" size={15} />
                <span>{contextLabel}</span>
                <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${contextLabel} Context`} iconLeft={<LucideIcon name="X" size={14} />} onClick={() => setContextAttached(false)} />
              </div>
            )}
            {recording ? (
              <div class="ui-ai-assistant__recording-preview">
                <span class="ui-ai-assistant__recording-dot" />
                <span><strong>Voice Preview</strong><small>No Audio Is Being Recorded</small></span>
                <time>{recordingTime}</time>
                <Button variant="ghost" size="sm" onClick={() => { setRecording(false); setRecordingSeconds(0); }}>Cancel</Button>
              </div>
            ) : (
              <Textarea
                value={draft}
                onInput={setDraft}
                rows={2}
                maxLength={2000}
                aria-label="Ask SIOMAC AI"
                placeholder="Ask SIOMAC AI anything…"
                class="ui-ai-assistant__textarea"
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    runPreview(draft);
                  }
                }}
              />
            )}

            <div class="ui-ai-assistant__composer-toolbar">
              <div class="ui-ai-assistant__composer-tools">
                <FileInput
                  files={files}
                  onChange={next => { setFiles(next); setFileError(''); }}
                  onReject={rejections => setFileError(rejections.map(item => item.message).join(' '))}
                  multiple
                  maxFiles={5}
                  maxSizeMb={25}
                  triggerLabel="Attach Files"
                  size="sm"
                  aria-label="Attach Files"
                  class="ui-ai-assistant__file-trigger"
                />
                <Button variant="ghost" size="sm" iconOnly aria-label="Insert Suggested Prompt" title="Insert Suggested Prompt" iconLeft={<LucideIcon name="MessageCircleQuestion" size={17} />} onClick={() => setDraft(DEFAULT_PROMPT)} />
              </div>
              <div class="ui-ai-assistant__composer-submit">
                <Button variant="ghost" size="sm" iconOnly aria-label={recording ? 'Finish Voice Preview' : 'Start Voice Preview'} pressed={recording} iconLeft={<LucideIcon name={recording ? 'Square' : 'Mic'} size={17} />} onClick={() => { setRecording(value => !value); setRecordingSeconds(0); }} />
                <Button class="ui-ai-assistant__send" variant="primary" size="sm" iconOnly aria-label="Send Preview Prompt" disabled={!draft.trim() || recording} iconLeft={<LucideIcon name="ArrowUp" size={18} />} onClick={() => runPreview(draft)} />
              </div>
            </div>
          </div>
          <p class="ui-ai-assistant__disclaimer">Interface Preview · Responses Are Not Generated, Sent, Or Saved.</p>
        </div>
      </Dialog.Body>
    </Dialog>
  );
}
