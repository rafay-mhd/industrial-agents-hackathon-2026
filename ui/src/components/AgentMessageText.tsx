/** Present numbered replies without rewriting any of the agent's words. */
export function AgentMessageText({ text }: { text: string }) {
  const lines = text.split("\n");
  if (lines.filter((line) => /^\s*\d+[.)]\s+/.test(line)).length < 2)
    return <p>{text}</p>;
  const blocks: (
    { text: string } | { steps: { number: number; text: string }[] }
  )[] = [];
  for (const line of lines) {
    const match = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    const previous = blocks.at(-1);
    if (match) {
      const step = { number: Number(match[1]), text: match[2] };
      if (previous && "steps" in previous) previous.steps.push(step);
      else blocks.push({ steps: [step] });
    } else if (previous && "text" in previous) previous.text += `\n${line}`;
    else blocks.push({ text: line });
  }
  return (
    <div className="glass-answer">
      {blocks.map((block, index) =>
        "steps" in block ? (
          <ol key={index} className="glass-written-directions">
            {block.steps.map((step, i) => (
              <li key={i} value={step.number}>
                <span>{step.text}</span>
              </li>
            ))}
          </ol>
        ) : block.text.trim() ? (
          <p key={index}>{block.text.trim()}</p>
        ) : null,
      )}
    </div>
  );
}
