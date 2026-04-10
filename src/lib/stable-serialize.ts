export const stableSerialize = (value: unknown): string => {
  if (value instanceof Date) {
    const isoValue = value.toJSON();
    return JSON.stringify({
      $type: "Date",
      value: isoValue ?? "Invalid Date",
    });
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};
