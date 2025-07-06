export function getVariancePop(values: number[]) {
  const n = values.length
  const mean = values.reduce((acc, curVal) => acc + curVal) / n

  const variancePop =
    values
      .map((curVal) => Math.pow(curVal - mean, 2))
      .reduce((acc, curVal) => acc + curVal) / n
  return variancePop
}

export function getVarianceSample(values: number[]) {
  const n = values.length
  const mean = values.reduce((acc, curVal) => acc + curVal) / n
  const varianceSample =
    values
      .map((curVal) => Math.pow(curVal - mean, 2))
      .reduce((acc, curVal) => acc + curVal) /
    (n - 1)
  return varianceSample
}
