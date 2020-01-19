import { Container, View, Text, Button, Fieldset, Canvas } from './ui.mjs'
import { RenderSimulation } from '../render-simulation.mjs'
import { easeInOutQuart } from '../utils.mjs'

const history = []
let generation
let currentGeneration
function simGeneration () {
  return sendWorker({ type: 'simulate' }).then(({ creatures }) => {
    currentGeneration = creatures.map(data => new Creature(data).reset())
    const histogram = new Map()
    const demographics = new Map()
    for (const creature of currentGeneration) {
      if (histogram.has(creature.data.fitness)) {
        histogram.set(creature.data.fitness, histogram.get(creature.data.fitness) + 1)
      } else {
        histogram.set(creature.data.fitness, 1)
      }
      const creatureClass = `n${creature.nodes.length}m${creature.muscles.length}`
      if (demographics.has(creatureClass)) {
        demographics.set(creatureClass, demographics.get(creatureClass) + 1)
      } else {
        demographics.set(creatureClass, 1)
      }
    }
    const percentiles = {}
    for (let i = 0; i <= 10; i++) {
      percentiles[10 - i * 10] = creatures[Math.min(
        Math.floor(creatures.length * i / 10),
        creatures.length - 1
      )].data.fitness
    }
    for (let i = 1; i < 10; i++) {
      percentiles[100 - i] = creatures[Math.min(
        Math.floor(creatures.length * i / 100),
        creatures.length - 1
      )].data.fitness
      percentiles[i] = creatures[Math.min(
        Math.floor(creatures.length * (1 - i / 100)),
        creatures.length - 1
      )].data.fitness
    }
    history.push({
      histogram,
      demographics,
      best: creatures[0],
      median: creatures[Math.floor(creatures.length / 2)],
      worst: creatures[creatures.length - 1]
    })
  })
}
function nextGeneration () {
  return sendWorker({ type: 'reproduce' }).then(({ creatures }) => {
    currentGeneration = creatures.map(data => new Creature(data).reset())
  })
}

const views = {
  start: new View('start-view', [
    new Text('title', 'Epic evolution'),
    new Button('start-btn', 'Start', btn => {
      document.body.classList.add('state-gen0')
      btn.elem.disabled = true
      sendWorker({ type: 'start' }).then(({ creatures }) => {
        currentGeneration = creatures.map(creature => new Creature(creature).reset())
        showView(views.creatures)
      })
    })
  ]),
  creatures: new View('creatures-view', [
    new Canvas('creatures', (wrapper, view) => {
      const { canvas, ctx: c } = wrapper
      let cols, rows, horizSpacing, vertSpacing

      let showDead = false
      wrapper.on('repaint', () => {
        if (animationTime !== null) return

        c.clearRect(0, 0, wrapper.width, wrapper.height)

        cols = Math.round(Math.sqrt(currentGeneration.length * wrapper.width / wrapper.height))
        rows = Math.ceil(currentGeneration.length / cols)
        horizSpacing = wrapper.width / (cols + 1)
        vertSpacing = wrapper.height / (rows + 1)
        const prop = currentGeneration[0].data.rank === undefined ||
          currentGeneration.notSorted ? 'id' : 'rank'
        for (const creature of currentGeneration) {
          const index = creature.data[prop]
          if (showDead && creature.data.willDie) {
            c.fillStyle = 'black'
            c.fillRect(
              (index % cols + 0.5) * horizSpacing,
              (Math.floor(index / cols) + 0.5) * vertSpacing,
              horizSpacing,
              vertSpacing
            )
          } else {
            c.save()
            c.translate(
              (index % cols + 1) * horizSpacing,
              (Math.floor(index / cols) + 1.5) * vertSpacing
            )
            // Creatures are approximately 1.5 un tall at most
            c.scale(vertSpacing / 2 / 1.5, vertSpacing / 2 / 1.5)
            creature.render(c)
            c.restore()
          }
        }
      })

      const previewMarker = document.createElement('div')
      previewMarker.classList.add('preview-marker')
      wrapper.elem.appendChild(previewMarker)
      let showingPreview = false
      function setPreview (e) {
        const rect = wrapper.elem.getBoundingClientRect()
        const x = Math.floor((e.clientX - rect.left) / horizSpacing - 0.5)
        const y = Math.floor((e.clientY - rect.top) / vertSpacing - 0.5)
        const index = x + y * cols
        const prop = currentGeneration[0].data.rank === undefined ||
          currentGeneration.notSorted ? 'id' : 'rank'
        const creature = currentGeneration.find(creature => creature.data[prop] === index)
        if (creature && x >= 0 && x < cols && y >= 0 && y < rows) {
          showingPreview = true
          views.creaturePreview.emit('preview', creature)
          previewMarker.style.left = (x + 0.5) * horizSpacing + 'px'
          previewMarker.style.top = (y + 0.5) * vertSpacing + 'px'
          previewMarker.style.width = horizSpacing + 'px'
          previewMarker.style.height = vertSpacing + 'px'
          previewMarker.classList.add('showing')
        } else if (showingPreview) {
          views.creaturePreview.hide()
          showingPreview = false
          previewMarker.classList.remove('showing')
        }
      }
      function hidePreview () {
        if (showingPreview) {
          views.creaturePreview.hide()
          showingPreview = false
          previewMarker.classList.remove('showing')
        }
      }
      wrapper.elem.addEventListener('pointerdown', setPreview)
      wrapper.elem.addEventListener('pointermove', setPreview)
      wrapper.elem.addEventListener('pointerleave', hidePreview)

      const ANIM_LENGTH = 3
      let animationTime = null
      const sortingAnimation = new RenderSimulation({
        render: (_, elapsed) => {
          if (animationTime === null) return

          animationTime += elapsed
          const progress = animationTime / ANIM_LENGTH
          if (progress >= 1) {
            sortingAnimation.stop()
            document.body.classList.remove('state-sorting')
            document.body.classList.add('state-sorted')
            animationTime = null
            wrapper.emit('repaint')
            return
          }
          const position = easeInOutQuart(progress)

          c.clearRect(0, 0, wrapper.width, wrapper.height)
          horizSpacing = wrapper.width / (cols + 1)
          vertSpacing = wrapper.height / (rows + 1)
          for (const creature of currentGeneration) {
            c.save()
            c.translate(
              (position * (creature.destX - creature.initX) + creature.initX) * horizSpacing,
              (position * (creature.destY - creature.initY) + creature.initY) * vertSpacing
            )
            c.scale(vertSpacing / 2 / 1.5, vertSpacing / 2 / 1.5)
            creature.render(c)
            c.restore()
          }
        },
        // Don't even dare try to simulate anything
        maxDelay: 0
      })
      view.on('sort', () => {
        cols = Math.round(Math.sqrt(currentGeneration.length * wrapper.width / wrapper.height))
        rows = Math.ceil(currentGeneration.length / cols)
        for (const creature of currentGeneration) {
          creature.initX = (creature.data.id % cols + 1)
          creature.initY = Math.floor(creature.data.id / cols) + 1.5
          creature.destX = (creature.data.rank % cols + 1)
          creature.destY = Math.floor(creature.data.rank / cols) + 1.5
        }
        currentGeneration.notSorted = false

        animationTime = 0
        sortingAnimation.start()
      })
      view.on('show-dead', () => {
        showDead = true
        wrapper.emit('repaint')
      })
      view.on('show-new', () => {
        showDead = false
        wrapper.emit('repaint')
      })
    }),
    new Container('creature-btns', [
      new Container('gen0', [
        new Text('', 'Here\'s a thousand randomly-generated creatures to start with'),
        new Button('', 'Okay', () => {
          document.body.classList.remove('state-gen0')
          generation = 0
          showView(views.generations)
        })
      ]),
      new Container('results', [
        new Text('', 'Here\'re the results!'),
        new Button('', 'Sort', btn => {
          document.body.classList.remove('state-results')
          document.body.classList.add('state-sorting')
          btn.view.emit('sort')
        })
      ]),
      new Container('sorting', [
        new Text('', 'Sorting!')
      ]),
      new Container('sorted', [
        new Text('', 'From the top to bottom are the fastest to slowest.'),
        new Button('', 'Semigenocide', btn => {
          document.body.classList.remove('state-sorted')
          document.body.classList.add('state-dead')
          btn.view.emit('show-dead')
        })
      ]),
      new Container('dead', [
        new Text('', 'Faster creatures are more likely to survive to reproduce.'),
        new Button('', 'Reproduce', btn => {
          btn.disabled = true
          nextGeneration().then(() => {
            btn.disabled = false
            document.body.classList.remove('state-dead')
            document.body.classList.add('state-reproduction')
            btn.view.emit('show-new')
          })
        })
      ]),
      new Container('reproduction', [
        new Text('', 'Here are the contenders of the next generation.'),
        new Button('', 'Nice', btn => {
          document.body.classList.remove('state-reproduction')
          generation = history.length
          showView(views.generations)
        })
      ])
    ])
  ]),
  generations: new View('generations-view', [
    new Container('gen-side gen-left', [
      new Text('heading', '', (text, view) => {
        view.on('show', () => {
          text.elem.textContent = `Generation ${generation}`
        })
      }),
      new Canvas('line-graph'),
      new Canvas('area-graph')
    ]),
    new Container('gen-side gen-right', [
      new Fieldset('gens-buttons', [
        new Button('', 'Watch next generation', () => {
          showView(views.watch)
        }),
        new Button('', 'Generate immediately', btn => {
          btn.parent.elem.disabled = true
          simGeneration().then(() => {
            btn.parent.elem.disabled = false
            currentGeneration.notSorted = true
            document.body.classList.add('state-results')
            showView(views.creatures)
          })
        }),
        new Button('', 'Generate automatically', btn => {
          if (btn.playing) {
            btn.elem.textContent = 'Generate automatically'
            btn.elem.disabled = true
            btn.playing = false
            btn.nextGen.then(() => {
              btn.parent.descendants[0].elem.disabled = false
              btn.parent.descendants[1].elem.disabled = false
              btn.elem.disabled = false
            })
          } else {
            btn.elem.textContent = 'Stop generating'
            btn.parent.descendants[0].elem.disabled = true
            btn.parent.descendants[1].elem.disabled = true
            btn.playing = true
            function nextGen () {
              btn.nextGen = simGeneration()
                .then(nextGeneration)
                .then(() => {
                  generation = history.length
                  showView(views.generations)
                  if (btn.playing) nextGen()
                })
            }
            nextGen()
          }
        })
      ]),
      new Container('winners'),
      new Canvas('histogram')
    ])
  ]),
  watch: new View('watch-view', [
    new Canvas('watch', (wrapper, view) => {
      const { canvas, ctx: c, sizeReady } = wrapper
      let current, scrollX, scrollY, clock, stop, creatures, simGenerationReady

      const renderer = new RenderSimulation({
        render: () => {
          if (stop) return

          c.clearRect(0, 0, wrapper.width, wrapper.height)
          c.fillStyle = 'forestgreen'
          c.fillRect(0, -scrollY, wrapper.width, wrapper.height + scrollY)

          if (current === null) return
          c.fillStyle = 'black'
          c.textBaseline = 'top'
          c.font = '16px monospace'
          c.fillText(`Creature ${current + 1} of ${creatures.length}`, 5, 5)
          c.fillText(`Time: ${clock.toFixed(2)}s`, 5, 25)
          c.fillText(`Distance: ${creatures[current].position().x.toFixed(2)}m`, 5, 45)

          c.save()
          c.translate(-scrollX, -scrollY)
          // The ~1.1 un tall creature should take up 60% of the screen height
          c.scale(wrapper.height * 0.1 / 1.1, wrapper.height * 0.1 / 1.1)
          creatures[current].render(c)
          c.restore()
        },
        simulate: time => {
          if (stop) return

          if (current === null || clock > 15) {
            clock = 0
            if (current === null) {
              current = 0
            } else {
              current++
              if (current >= creatures.length) {
                stop = true
                simGenerationReady.then(() => {
                  document.body.classList.add('state-results')
                  showView(views.creatures)
                })
                return
              }
            }
          }

          creatures[current].sim(time)
          clock += time
        },
        simTime: SIM_TIME
      })
      view.on('show', () => {
        creatures = currentGeneration
        simGenerationReady = simGeneration()
        sizeReady.then(() => {
          stop = false
          current = null
          scrollX = -wrapper.width / 2
          scrollY = -wrapper.height + 50
          renderer.start()
        })
      })
      view.on('hide', () => {
        renderer.stop()
      })
    })
  ]),
  creaturePreview: new View('creature-preview', [
    new Container('preview-content', [
      new Text('creature-info', '', (text, view) => {
        view.on('info', creature => {
          const lines = [
            `Creature ${creature.data.id}`,
            `Class n${creature.nodes.length}m${creature.muscles.length}`
          ]
          if (creature.data.rank !== undefined) {
            lines.push(`Ranked #${creature.data.rank + 1}`)
          }
          if (creature.data.fitness !== undefined) {
            lines.push(`Fitness: ${creature.data.fitness.toFixed(4)}`)
          }
          text.elem.textContent = lines.join('\n')
        })
      }),
      new Canvas('preview', (wrapper, view) => {
        let pointerX, pointerY, width, height, windowWidth, windowHeight
        document.addEventListener('pointermove', e => {
          pointerX = e.clientX
          pointerY = e.clientY
          if (!view.hidden) {
            const rect = view.elem.getBoundingClientRect()
            width = rect.width
            height = rect.height
            view.elem.style.left = (width && pointerX + width > windowWidth ? pointerX - width : pointerX) + 'px'
            view.elem.style.top = (height && pointerY + height > windowHeight ? pointerY - height : pointerY) + 'px'
          }
        })
        view.on('resize', onReady => {
          const rect = view.elem.getBoundingClientRect()
          width = rect.width
          height = rect.height
          windowWidth = window.innerWidth
          windowHeight = window.innerHeight
          return onReady.then(() => {
            view.elem.style.left = (pointerX + width > windowWidth ? pointerX - width : pointerX) + 'px'
            view.elem.style.top = (pointerY + height > windowHeight ? pointerY - height : pointerY) + 'px'
          })
        })

        // Sad code repetition. Maybe one day I'll derepetitivify it
        const { canvas, ctx: c, sizeReady } = wrapper
        let creature, scrollX, scrollY, clock

        const renderer = new RenderSimulation({
          render: () => {
            c.fillStyle = clock > 15 ? '#6095a9' : 'skyblue'
            c.fillRect(0, 0, wrapper.width, wrapper.height)

            c.fillStyle = 'forestgreen'
            c.fillRect(0, -scrollY, wrapper.width, wrapper.height + scrollY)

            // TODO: I think all this should be done while scaled (as in, scrollX/
            // scrollY should be in terms of simulation units)
            const scale = wrapper.height * 0.2 / 1.1

            c.strokeStyle = 'rgba(0, 0, 0, 0.2)'
            const startTick = Math.floor(scrollX / scale)
            const stopTick = Math.ceil((scrollX + wrapper.width) / scale)
            c.beginPath()
            for (let i = startTick; i < stopTick; i++) {
              c.moveTo(i * scale - scrollX, -scrollY)
              c.lineTo(i * scale - scrollX, -scrollY + 10)
            }
            c.stroke()

            c.fillStyle = 'black'
            c.textBaseline = 'top'
            c.font = '16px monospace'
            c.fillText(`Time: ${clock.toFixed(2)}s`, 5, 2)
            c.fillText(`Distance: ${creature.position().x.toFixed(4)}m`, 5, 25)

            c.save()
            c.translate(-scrollX, -scrollY)
            // The ~1.1 un tall creature should take up 20% of the screen height
            c.scale(scale, scale)
            creature.render(c)
            c.restore()
          },
          simulate: time => {
            creature.sim(time)
            clock += time
            scrollX += (creature.position().x * wrapper.height * 0.2 / 1.1 - wrapper.width / 2 - scrollX) / 10
          },
          simTime: SIM_TIME
        })
        view.on('preview', previewCreature => {
          if (creature === previewCreature) return
          if (view.hidden) {
            view.show()
            view.resize()
          }
          creature = previewCreature
          view.emit('info', creature)
          clock = 0
          creature.reset()
          sizeReady.then(() => {
            if (!creature) return // In case it is aborted early
            scrollX = -wrapper.width / 2
            scrollY = -wrapper.height + 50
            renderer.start()
          })
        })
        view.on('hide', () => {
          creature = null
          renderer.stop()
        })
      })
    ])
  ])
}
let currentView
function showView (view) {
  if (currentView) {
    currentView.hide()
  }
  view.show()
  view.resize()
  currentView = view
}
window.addEventListener('resize', e => {
  if (currentView) {
    currentView.resize()
  }
  if (!views.creaturePreview.hidden) {
    views.creaturePreview.resize()
  }
})
views.creaturePreview.addTo(document.body)

const worker = new Worker('./worker.js')
const expectingResponses = []
function sendWorker (data, response = true) {
  if (response) {
    return new Promise(resolve => {
      expectingResponses.push({ responseId: data.type, resolve })
      worker.postMessage(data)
    })
  } else {
    worker.postMessage(data)
  }
}
worker.addEventListener('message', ({ data }) => {
  switch (data.type) {
    case 'response':
      for (let i = 0; i < expectingResponses.length; i++) {
        if (data.response === expectingResponses[i].responseId) {
          expectingResponses[i].resolve(data)
          expectingResponses.splice(i, 1)
          i--
        }
      }
      break
  }
})
sendWorker({ type: 'init', key: 'epic' }).then(() => {
  showView(views.start)
})
