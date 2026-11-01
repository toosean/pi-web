"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Code2, ListChecks } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import {
  ASK_USER_LANGUAGE,
  ASK_USER_OTHER_SELECTION,
  areAskUserAnswersComplete,
  createEmptyAskUserAnswers,
  formatAskUserAnswers,
  isAskUserAnswerComplete,
  type AskUserAnswer,
  type AskUserChoice,
  type AskUserForm,
} from "@/lib/ask-user";
import { CodeBlock } from "./MermaidBlock";

interface Props {
  form: AskUserForm;
  source: string;
  interactive: boolean;
  onInsert?: (answer: string) => boolean;
}

// Safari reports a composing Enter as keyCode 229 without isComposing.
function isComposingKey(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function selectedLabelsOf(
  question: AskUserForm["questions"][number],
  answer: AskUserAnswer | undefined,
  otherLabel: string,
): string[] {
  if (!answer) return [];
  const labels = [...new Set(answer.choices)]
    .filter((choice): choice is number => typeof choice === "number")
    .sort((left, right) => left - right)
    .map((choice) => question.options[choice]?.label)
    .filter((label): label is string => Boolean(label));
  if (answer.choices.includes(ASK_USER_OTHER_SELECTION)) labels.push(otherLabel);
  return labels;
}

export function AskUserBlock({ form, source, interactive, onInsert }: Props) {
  const { t } = useI18n();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AskUserAnswer[]>(() => createEmptyAskUserAnswers(form));
  const [inserted, setInserted] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const firstOptionRef = useRef<HTMLInputElement | null>(null);
  const optionsRef = useRef<HTMLDivElement | null>(null);
  const insertButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusFirstOptionRef = useRef(false);

  // Focus the first option as soon as the interactive form appears. preventScroll
  // keeps a reader's place in a long transcript; only the live block is interactive.
  useEffect(() => {
    if (!interactive || inserted || showSource) return;
    const frame = requestAnimationFrame(() => {
      firstOptionRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [interactive, inserted, showSource]);

  // Keyboard-driven question changes land on the new question's first option.
  useEffect(() => {
    if (!focusFirstOptionRef.current) return;
    focusFirstOptionRef.current = false;
    const frame = requestAnimationFrame(() => {
      firstOptionRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentIndex]);

  const updateAnswer = (patch: Partial<AskUserAnswer>) => {
    setAnswers((current) => current.map((answer, index) => (
      index === currentIndex ? { ...answer, ...patch } : answer
    )));
  };

  const toggleChoice = (choice: AskUserChoice) => {
    setAnswers((current) => current.map((answer, index) => {
      if (index !== currentIndex) return answer;
      const selected = answer.choices.includes(choice);
      return {
        ...answer,
        choices: selected
          ? answer.choices.filter((item) => item !== choice)
          : [...answer.choices, choice],
      };
    }));
  };

  const insertAnswers = () => {
    const markdown = formatAskUserAnswers(form, answers, {
      intro: t("askUser.answerIntro"),
      choice: t("askUser.answerChoice"),
      supplement: t("askUser.answerSupplement"),
      other: t("askUser.other"),
      answer: t("askUser.answerCustom"),
      separator: t("askUser.answerSeparator"),
      join: t("askUser.answerJoin"),
    });
    if (!markdown || !onInsert?.(markdown)) return;
    setInserted(true);
  };

  if (showSource) {
    return (
      <CodeBlock
        code={source}
        lang={ASK_USER_LANGUAGE}
        headerAction={(
          <button
            type="button"
            className="ask-user-view-toggle"
            title={t("askUser.showForm")}
            aria-label={t("askUser.showForm")}
            onClick={() => setShowSource(false)}
          >
            <ListChecks aria-hidden="true" size={13} strokeWidth={2} />
          </button>
        )}
      />
    );
  }

  const sourceButton = (
    <button
      type="button"
      className="ask-user-view-toggle"
      title={t("askUser.showSource")}
      aria-label={t("askUser.showSource")}
      onClick={() => setShowSource(true)}
    >
      <Code2 aria-hidden="true" size={13} strokeWidth={2} />
    </button>
  );

  if (!interactive || inserted) {
    return (
      <section className="ask-user-block" data-ask-user-state={inserted ? "inserted" : "readonly"}>
        <header className="ask-user-header">
          <span className="ask-user-title">{t("askUser.title")}</span>
          <span className="ask-user-header-meta">
            <span className="ask-user-status">
              {t(inserted ? "askUser.inserted" : "askUser.continued")}
            </span>
            {sourceButton}
          </span>
        </header>
        <div className="ask-user-summary">
          {form.questions.map((question, questionIndex) => {
            const answer = inserted ? answers[questionIndex] : undefined;
            const selected = selectedLabelsOf(question, answer, t("askUser.other"));
            return (
              <div className="ask-user-summary-question" key={`${questionIndex}-${question.prompt}`}>
                <div className="ask-user-summary-prompt">{questionIndex + 1}. {question.prompt}</div>
                <div className="ask-user-summary-description">{question.description}</div>
                {selected.length > 0 && answer ? (
                  <div className="ask-user-summary-answer">
                    <span>
                      {t("askUser.answerChoice")}
                      {t("askUser.answerSeparator")}
                      {selected.join(t("askUser.answerJoin"))}
                    </span>
                    {answer.supplement.trim() && (
                      <span>
                        {t(answer.choices.includes(ASK_USER_OTHER_SELECTION) ? "askUser.answerCustom" : "askUser.answerSupplement")}
                        {t("askUser.answerSeparator")}
                        {answer.supplement.trim()}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="ask-user-summary-options">
                    {question.options.map((option) => (
                      <span key={option.label}>
                        {option.label}{option.recommended ? ` · ${t("askUser.recommended")}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  const question = form.questions[currentIndex];
  const answer = answers[currentIndex];
  const currentComplete = isAskUserAnswerComplete(answer);
  const allComplete = areAskUserAnswersComplete(form, answers);
  const isLast = currentIndex === form.questions.length - 1;
  const hasOther = answer.choices.includes(ASK_USER_OTHER_SELECTION);

  const advance = () => {
    if (!currentComplete) return;
    if (isLast) {
      insertButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    focusFirstOptionRef.current = true;
    setCurrentIndex((index) => Math.min(form.questions.length - 1, index + 1));
  };

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const inputs = optionsRef.current
        ? Array.from(optionsRef.current.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
        : [];
      const index = inputs.indexOf(event.currentTarget);
      if (index === -1) return;
      inputs[event.key === "ArrowDown" ? index + 1 : index - 1]?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      advance();
    }
  };

  const handleSupplementKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || isComposingKey(event)) return;
    event.preventDefault();
    advance();
  };

  return (
    <section className="ask-user-block" data-ask-user-state="interactive">
      <header className="ask-user-header">
        <span className="ask-user-title">{t("askUser.title")}</span>
        <span className="ask-user-header-meta">
          <span className="ask-user-hint">{t("askUser.multiSelect")}</span>
          <span className="ask-user-progress">
            {t("askUser.progress", { current: currentIndex + 1, total: form.questions.length })}
          </span>
          {sourceButton}
        </span>
      </header>

      <fieldset className="ask-user-question">
        <legend>{question.prompt}</legend>
        <p className="ask-user-question-description">{question.description}</p>
        <div className="ask-user-options" ref={optionsRef}>
          {question.options.map((option, optionIndex) => {
            const checked = answer.choices.includes(optionIndex);
            return (
              <label
                className={`ask-user-option${checked ? " is-selected" : ""}`}
                key={option.label}
              >
                <input
                  ref={optionIndex === 0 ? firstOptionRef : undefined}
                  type="checkbox"
                  name={`ask-user-question-${currentIndex}`}
                  checked={checked}
                  onChange={() => toggleChoice(optionIndex)}
                  onKeyDown={handleOptionKeyDown}
                />
                <span className="ask-user-option-copy">
                  <span className="ask-user-option-label">
                    {option.label}
                    {option.recommended && <span className="ask-user-recommended">{t("askUser.recommended")}</span>}
                  </span>
                  <span className="ask-user-option-description">{option.description}</span>
                </span>
              </label>
            );
          })}
          <label className={`ask-user-option${hasOther ? " is-selected" : ""}`}>
            <input
              type="checkbox"
              name={`ask-user-question-${currentIndex}`}
              checked={hasOther}
              onChange={() => toggleChoice(ASK_USER_OTHER_SELECTION)}
              onKeyDown={handleOptionKeyDown}
            />
            <span className="ask-user-option-copy">
              <span className="ask-user-option-label">{t("askUser.other")}</span>
              <span className="ask-user-option-description">{t("askUser.otherDescription")}</span>
            </span>
          </label>
        </div>

        <label className="ask-user-supplement">
          <span>
            {t(hasOther ? "askUser.customAnswer" : "askUser.supplement")}
            {hasOther && <span aria-hidden="true"> *</span>}
          </span>
          <textarea
            name="ask-user-supplement"
            value={answer.supplement}
            className={answer.supplement.trim() ? "has-value" : undefined}
            onChange={(event) => updateAnswer({ supplement: event.target.value })}
            onKeyDown={handleSupplementKeyDown}
            placeholder={t(hasOther ? "askUser.customPlaceholder" : "askUser.supplementPlaceholder")}
            rows={1}
          />
        </label>
      </fieldset>

      <footer className="ask-user-footer">
        <button
          type="button"
          className="ask-user-button"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
        >
          <span aria-hidden="true">&larr;</span>
          {t("askUser.previous")}
        </button>
        {isLast ? (
          <button
            ref={insertButtonRef}
            type="button"
            className="ask-user-button is-primary"
            disabled={!allComplete}
            onClick={insertAnswers}
          >
            {t("askUser.insert")}
          </button>
        ) : (
          <button
            type="button"
            className="ask-user-button is-primary"
            disabled={!currentComplete}
            onClick={() => setCurrentIndex((index) => Math.min(form.questions.length - 1, index + 1))}
          >
            {t("askUser.next")}
            <span aria-hidden="true">&rarr;</span>
          </button>
        )}
      </footer>
    </section>
  );
}
