"use client"

import * as React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type FieldControlProps = {
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: React.AriaAttributes["aria-invalid"]
}

function Field({
  label,
  controlId,
  description,
  error,
  className,
  children,
}: {
  label: React.ReactNode
  controlId?: string
  description?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: React.ReactElement<FieldControlProps>
}) {
  const generatedId = React.useId()
  const resolvedControlId =
    controlId ?? children.props.id ?? `field-${generatedId}`
  const hasDescription = description !== undefined && description !== null
  const hasError = error !== undefined && error !== null && error !== false
  const descriptionId = hasDescription
    ? `${resolvedControlId}-description`
    : undefined
  const errorId = hasError ? `${resolvedControlId}-error` : undefined
  const describedBy = mergeIds(
    children.props["aria-describedby"],
    descriptionId,
    errorId,
  )

  return (
    <div data-slot="field" className={cn("grid gap-2", className)}>
      <Label htmlFor={resolvedControlId}>{label}</Label>
      {React.cloneElement(children, {
        id: resolvedControlId,
        "aria-describedby": describedBy,
        "aria-invalid": hasError
          ? true
          : children.props["aria-invalid"],
      })}
      {hasDescription ? (
        <p
          id={descriptionId}
          data-slot="field-description"
          className="text-xs text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {hasError ? (
        <p
          id={errorId}
          data-slot="field-error"
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

function mergeIds(...values: Array<string | undefined>) {
  const ids = values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? [])
  return ids.length > 0 ? [...new Set(ids)].join(" ") : undefined
}

export { Field }
