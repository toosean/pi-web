"use client";

import { useId, useState } from "react";
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
  type AskUserForm,
  type AskUserSelection,
} from "@/lib/ask-user";
import { CodeBlock } from "./MermaidBlock";

interface Props {
  form: AskUserForm;
  source: string;
  interactive: boolean;
  onInsert?: (answer: string) => boolean;
}

export function AskUserBlock({ form, source, interactive, onInsert }: Props) {
  const { t } = useI18n();
  const groupId = useId();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AskUserAnswer[]>(() => createEmptyAskUserAnswers(form));
  const [inserted, setInserted] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const updateAnswer = (patch: Partial<AskUserAnswer>) => {
    setAnswers((current) => current.map((answer, index) => (
      index === currentIndex ? { ...answer, ...patch } : answer
    )));
  };

  const insertAnswers = () => {
    const markdown = formatAskUserAnswers(form, answers, {
      intro: t("askUser.answerIntro"),
      choice: t("askUser.answerChoice"),
      supplement: t("askUser.answerSupplement"),
      other: t("askUser.other"),
      answer: t("askUser.answerCustom"),
      separator: t("askUser.answerSeparator"),
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
            <ListChecks aria-hidden="true" size={15} strokeWidth={2} />
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
      <Code2 aria-hidden="true" size={15} strokeWidth={2} />
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
            const selectedLabel = answer?.selection === ASK_USER_OTHER_SELECTION
              ? t("askUser.other")
              : typeof answer?.selection === "number"
                ? question.options[answer.selection]?.label
                : null;
            return (
              <div className="ask-user-summary-question" key={`${questionIndex}-${question.prompt}`}>
                <div className="ask-user-summary-prompt">{questionIndex + 1}. {question.prompt}</div>
                {selectedLabel ? (
                  <div className="ask-user-summary-answer">
                    <span>{t("askUser.answerChoice")}{t("askUser.answerSeparator")}{selectedLabel}</span>
                    {answer?.supplement.trim() && (
                      <span>
                        {t(answer.selection === ASK_USER_OTHER_SELECTION ? "askUser.answerCustom" : "askUser.answerSupplement")}
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
  const radioName = `${groupId}-question-${currentIndex}`;

  const select = (selection: AskUserSelection) => {
    updateAnswer({ selection });
    if (selection !== ASK_USER_OTHER_SELECTION && !isLast) {
      setCurrentIndex((index) => Math.min(form.questions.length - 1, index + 1));
    }
  };

  return (
    <section className="ask-user-block" data-ask-user-state="interactive">
      <header className="ask-user-header">
        <span className="ask-user-title">{t("askUser.title")}</span>
        <span className="ask-user-header-meta">
          <span className="ask-user-progress">
            {t("askUser.progress", { current: currentIndex + 1, total: form.questions.length })}
          </span>
          {sourceButton}
        </span>
      </header>

      <fieldset className="ask-user-question">
        <legend>{question.prompt}</legend>
        <div className="ask-user-options">
          {question.options.map((option, optionIndex) => (
            <label
              className={`ask-user-option${answer.selection === optionIndex ? " is-selected" : ""}`}
              key={option.label}
            >
              <input
                type="radio"
                name={radioName}
                checked={answer.selection === optionIndex}
                onChange={() => select(optionIndex)}
              />
              <span className="ask-user-option-copy">
                <span className="ask-user-option-label">
                  {option.label}
                  {option.recommended && <span className="ask-user-recommended">{t("askUser.recommended")}</span>}
                </span>
                <span className="ask-user-option-description">{option.description}</span>
              </span>
            </label>
          ))}
          <label className={`ask-user-option${answer.selection === ASK_USER_OTHER_SELECTION ? " is-selected" : ""}`}>
            <input
              type="radio"
              name={radioName}
              checked={answer.selection === ASK_USER_OTHER_SELECTION}
              onChange={() => select(ASK_USER_OTHER_SELECTION)}
            />
            <span className="ask-user-option-copy">
              <span className="ask-user-option-label">{t("askUser.other")}</span>
              <span className="ask-user-option-description">{t("askUser.otherDescription")}</span>
            </span>
          </label>
        </div>

        <label className="ask-user-supplement">
          <span>
            {t(answer.selection === ASK_USER_OTHER_SELECTION ? "askUser.customAnswer" : "askUser.supplement")}
            {answer.selection === ASK_USER_OTHER_SELECTION && <span aria-hidden="true"> *</span>}
          </span>
          <textarea
            value={answer.supplement}
            onChange={(event) => updateAnswer({ supplement: event.target.value })}
            placeholder={t(answer.selection === ASK_USER_OTHER_SELECTION ? "askUser.customPlaceholder" : "askUser.supplementPlaceholder")}
            rows={3}
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
