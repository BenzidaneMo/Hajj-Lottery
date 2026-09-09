import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/alert-dialog'
import { Button } from '@/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/dialog'
import { Label } from '@/components/shadcn/label'
import { Textarea } from '@/components/shadcn/textarea'
import { MAX_REASON_LENGTH } from '@hajj-lottery/shared'

import { ErrorNotice } from './ErrorNotice'

/**
 * The two ways this console asks "are you sure?".
 *
 * `ConfirmDialog` is for an irreversible act whose consequence can be stated
 * in advance — freezing a pool, running a lottery, publishing a result. It is
 * an AlertDialog, so it traps focus and cannot be dismissed by clicking past
 * it, and it always lists the facts the server will act on rather than asking
 * the operator to remember them from the page behind.
 *
 * `ReasonDialog` is for an act somebody has to account for. The explanation is
 * part of the operation, not a courtesy: a place taken away from the person
 * who won it, with no record of why, is indistinguishable from a mistake once
 * everybody involved has moved on.
 *
 * Neither uses `window.confirm`. A native dialog cannot be translated, cannot
 * be read in the page's language direction, and cannot say what it is about to
 * do in more than one line.
 */

export interface Fact {
  label: string
  value: ReactNode
}

/** The facts a confirmation is about, as a description list. */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm sm:grid-cols-2">
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className="font-medium text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What will happen, in plain words. Shown before the facts. */
  description: string
  facts?: Fact[]
  confirmLabel: string
  /** Marks the action as one that takes something away. */
  destructive?: boolean
  pending?: boolean
  error?: unknown
  onConfirm: () => void
  children?: ReactNode
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  facts,
  confirmLabel,
  destructive,
  pending,
  error,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {facts && facts.length > 0 && <FactList facts={facts} />}
        {children}
        {error !== undefined && <ErrorNotice error={error} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('admin.actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={
              destructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined
            }
            onClick={(event) => {
              // The dialog closes itself on click; the caller decides when the
              // work is done, so the default must not run.
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? t('admin.actions.working') : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export interface ReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  facts?: Fact[]
  /** Label for the explanation field — "Reason", "Explanation", per action. */
  reasonLabel: string
  submitLabel: string
  destructive?: boolean
  pending?: boolean
  error?: unknown
  /** Extra fields rendered above the explanation — a category, usually. */
  children?: ReactNode
  /** Blocks submission while a caller-supplied field is unanswered. */
  disabled?: boolean
  onSubmit: (reason: string) => void
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  facts,
  reasonLabel,
  submitLabel,
  destructive,
  pending,
  error,
  children,
  disabled,
  onSubmit,
}: ReasonDialogProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)

  // Reopening must not offer the previous explanation for a different record —
  // an abandonment reason typed for one winner must not be sitting in the box
  // for the next. Cleared during render rather than in an effect, so the stale
  // text is never on screen for a frame.
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setReason('')
      setTouched(false)
    }
  }

  const blank = reason.trim().length === 0

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (blank || disabled) return
    onSubmit(reason.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/*
          `noValidate` so the browser's own bubble does not pre-empt the
          message below. The field keeps `required` for assistive technology;
          what changes is who reports the problem — a native bubble is
          untranslated, is not read in the page's direction, and cannot also
          say that a category is missing.
        */}
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          {facts && facts.length > 0 && <FactList facts={facts} />}
          {children}

          <div className="flex flex-col gap-2">
            <Label htmlFor="reason-field">{reasonLabel}</Label>
            <Textarea
              id="reason-field"
              value={reason}
              rows={4}
              maxLength={MAX_REASON_LENGTH}
              required
              aria-invalid={touched && blank}
              aria-describedby={touched && blank ? 'reason-error' : undefined}
              onChange={(event) => setReason(event.target.value)}
              onBlur={() => setTouched(true)}
            />
            {touched && blank && (
              <p id="reason-error" role="alert" className="text-sm text-destructive">
                {t('admin.actions.reasonRequired')}
              </p>
            )}
          </div>

          {error !== undefined && <ErrorNotice error={error} />}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              {t('admin.actions.cancel')}
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={pending}>
              {pending ? t('admin.actions.working') : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
