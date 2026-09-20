import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveSubject } from './derive-subject.ts'

test('takes the opening noun phrase, dropping the trailing action', () => {
  assert.equal(
    deriveSubject('A toy robot sitting on a shelf. It jumps down onto the floor'),
    'toy-robot',
  )
  assert.equal(deriveSubject('alien creature walking through a forest'), 'alien-creature')
})

test('strips leading framing / quality words', () => {
  assert.equal(deriveSubject('cinematic shot of an alien creature'), 'alien-creature')
  assert.equal(deriveSubject('A photo of a witch'), 'witch')
  assert.equal(deriveSubject('portrait of a king on a throne'), 'king')
})

test('keeps hyphenated compounds and stops at prepositions', () => {
  assert.equal(deriveSubject('A dark-haired woman with dual pistols'), 'dark-haired-woman')
})

test('single-word and already-clean prompts', () => {
  assert.equal(deriveSubject('witch'), 'witch')
  assert.equal(deriveSubject('3D owl mascot'), '3d-owl-mascot')
})

test('caps runaway phrases at MAX_WORDS', () => {
  assert.equal(deriveSubject('red sports car model on a highway'), 'red-sports-car')
})

test('falls back when there is nothing usable', () => {
  assert.equal(deriveSubject(''), 'gen')
  assert.equal(deriveSubject(null), 'gen')
  assert.equal(deriveSubject('   ', 'image'), 'image')
  assert.equal(deriveSubject('a the of', 'video'), 'video')
})
