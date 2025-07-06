import { describe, expect, it } from 'bun:test'
import { getVariancePop, getVarianceSample } from '../src/statutils'

describe('stat utils tests', () => {
  it('getVariancePop', () => {
    const values = [1, 2, 3, 4, 5]
    console.log(getVariancePop(values))
    expect(getVariancePop(values)).toBe(2)
  })
  it('getVariancePop 2', () => {
    const values = [3.4, 4.4, 1.0, 7.89, 1.1, -7.2, 1.01]
    console.log(getVariancePop(values))
    expect(getVariancePop(values)).toBe(18.431334693877552)
  })
  it('getVarianceSample', () => {
    const values = [1, 2, 3, 4, 5]
    console.log(getVarianceSample(values))
    expect(getVarianceSample(values)).toBe(2.5)
  })
  it('getVarianceSample 2', () => {
    const values = [3.4, 4.4, 1.0, 7.89, 1.1, -7.2, 1.01]
    console.log(getVarianceSample(values))
    expect(getVarianceSample(values)).toBe(21.503223809523814)
  })
})
