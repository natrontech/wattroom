// Shop helpers shared by shop.html and qa.mjs: which frame shows an item, how to stage it, what its price or rule reads.
export const tierPrice = (cat, it) => (it.tier ? cat.currency.tiers[it.tier] : null)
export function fitsFrame(it, f) {
  const r = it.requires ?? {}
  if (r.material && !r.material.includes(f.material)) return false
  if (r.brakes && !r.brakes.includes(f.parts.brakes)) return false
  if (r.derailleur && !f.parts.derailleur) return false
  if (r.bags && !f.allowed.bags) return false
  if (r.utility && !f.allowed.utility) return false
  if (it.slot === 'bars' && !f.allowed.bars.includes(it.id) && !['tt', 'upright'].includes(f.cockpit.bar)) return false
  if (it.slot === 'bars' && ['tt', 'upright'].includes(f.cockpit.bar) && f.defaults.bars !== it.id) return false
  if (it.slot === 'fork' && !f.allowed.forks.includes(it.id)) return false
  if (it.unlock?.startsWith('with:') && !it.unlock.slice(5).split('|').includes(f.id)) return false
  return true
}
// the frame an item is shown on: its own, the one it comes with, a preferred frame for the look, or the first that fits
const PREFER = { tyres: { 'tyre.knob': 'frame.gravel', 'tyre.tubular': 'frame.steel', 'tyre.cream': 'frame.rando', 'tyre.tan': 'frame.steel' }, finish: { 'finish.jahresring': 'frame.steel' }, bags: { 'bag.rando': 'frame.rando', 'bag.fullframe': 'frame.gravel', 'bag.halfframe': 'frame.gravel', 'bag.barroll': 'frame.gravel' }, pedals: { 'pedal.clips': 'frame.steel', 'pedal.flat': 'frame.gravel' }, saddle: { 'saddle.leather': 'frame.steel', 'saddle.suede': 'frame.alu90' }, groupset: { 'gs.downtube': 'frame.steel', 'gs.delta': 'frame.alu90' }, lights: { 'light.dynamo': 'frame.steel' }, utility: { 'util.pendler': 'frame.endurance' }, crank: { 'crank.five': 'frame.steel' }, hub: { 'hub.klick': 'frame.steel' }, bars: { 'bars.bullhorn': 'frame.steel', 'bars.track': 'frame.track' }, cages: { 'cage.collection': 'frame.race' }, bottles: { 'bottle.alu': 'frame.steel' } }
export function hostFrame(it, cat) {
  const frames = cat.items.filter((i) => i.slot === 'frame')
  if (it.slot === 'frame') return it
  const pref = PREFER[it.slot]?.[it.id]
  const pf = pref && frames.find((f) => f.id === pref)
  if (pf && fitsFrame(it, pf)) return pf
  return frames.find((f) => f.id === 'frame.race' && fitsFrame(it, f)) ?? frames.find((f) => fitsFrame(it, f))
}
const FRAME_COLOURS = { 'frame.race': ['slate', 'snow'], 'frame.aero': ['ink', 'sun'], 'frame.climb': ['snow', 'enzian'], 'frame.endurance': ['teal', 'glacier'], 'frame.gravel': ['army', 'apricot'], 'frame.cross': ['rust', 'cream'], 'frame.tt': ['snow', 'teal'], 'frame.hour': ['plum', 'sun'], 'frame.steel': ['brick', 'cream'], 'frame.zweihundert': ['enzian', 'cream'], 'frame.alu90': ['teal', 'sun'], 'frame.carbon03': ['graphite', 'silver'], 'frame.rando': ['lake', 'cream'], 'frame.track': ['plum', 'sun'], 'frame.ordonnanz': ['ink', 'army'] }
const KIT = { 'jp.gipfelpunkte': ['enzian', 'snow', 'ink'], 'jp.stickerei': ['enzian', 'ink', 'snow'], 'jp.scherenschnitt': ['cream', 'ink', 'brick'], 'jp.edelweiss': ['fir', 'sun', 'snow'], 'jp.jass': ['cream', 'brick', 'fir'], 'jp.karo': ['cream', 'brick', 'fir'], 'jp.topo': ['slate', 'glacier', 'sun'], 'jp.raeppli': ['plum', 'sun', 'glacier'], 'jp.nebelkit': ['lake', 'glacier', 'snow'], 'jp.sprinter': ['plum', 'sun', 'snow'], 'jp.crew': ['enzian', 'snow', 'sun'], 'jp.chrampfer': ['slate', 'chalk', 'snow'], 'jp.blocks': ['teal', 'sun', 'snow'], 'jp.fade': ['teal', 'glacier', 'snow'], 'jp.hoops': ['lake', 'glacier', 'snow'], 'jp.sash': ['snow', 'fir', 'lime'], 'jp.stripes': ['cream', 'brick', 'lake'], 'jp.chevron': ['apricot', 'army', 'cream'], 'jp.yoke': ['plum', 'sun', 'snow'], 'jp.sidepanel': ['graphite', 'apricot', 'snow'], 'jp.plain': ['alpine', 'ink', 'snow'] }
// A loadout that shows one item at its best: the host frame in a house colour, the kit colours that read the pattern.
export function thumbLoadout(it, cat, opt = null) {
  const f = hostFrame(it, cat)
  const fc = FRAME_COLOURS[f.id] ?? ['slate', 'snow']
  const base = cat.starterLoadout
  const lo = {
    ...base, name: it.name, frame: f.id, fork: f.defaults.fork, bars: f.defaults.bars, saddle: f.defaults.saddle, wheels: f.defaults.wheels, tyres: f.defaults.tyres, finish: 'finish.gloss',
    params: { ...base.params, tyreMm: f.defaults.tyreMm, sockH: 'tall', number: 42 }, opts: { ...base.opts },
    colours: { ...base.colours, frame: fc[0], frameAccent: fc[1], decal: fc[1], jerseyA: 'enzian', jerseyB: 'snow', jerseyC: 'sun', helmet: 'snow', helmetAccent: 'enzian', shorts: 'ink', shortsAccent: 'sun', socks: 'snow', sockAccent: 'enzian', gloves: 'ink', barTape: 'ink', bottle: 'snow' },
    skin: 'skin.3', hair: 'hair.short'
  }
  lo[it.slot] = it.id
  if (it.options?.length) lo.opts[it.slot] = opt ?? it.options[0].id
  const c = lo.colours
  if (it.slot === 'jersey' || it.slot === 'cut') { const k = KIT[lo.jersey] ?? KIT['jp.plain']; [c.jerseyA, c.jerseyB, c.jerseyC] = k; c.shortsAccent = k[0] }
  if (it.slot === 'cut') { lo.jersey = it.id === 'cut.wool' ? 'jp.stripes' : it.id === 'cut.skinsuit' ? 'jp.sprinter' : 'jp.sidepanel'; const k = KIT[lo.jersey]; [c.jerseyA, c.jerseyB, c.jerseyC] = k }
  if (it.slot === 'layer') { c.layer = { 'layer.gilet': 'graphite', 'layer.rain': 'glacier', 'layer.winter': 'army', 'layer.solstice': 'night' }[it.id] ?? 'graphite'; c.layerAccent = it.id === 'layer.winter' ? 'cream' : it.id === 'layer.solstice' ? 'sun' : 'sun'; lo.jersey = 'jp.hoops'; [c.jerseyA, c.jerseyB, c.jerseyC] = KIT['jp.hoops'] }
  if (it.slot === 'shorts') { c.shorts = 'ink'; c.shortsAccent = 'sun'; if (it.id === 'bib.wool') { c.shorts = 'graphite'; lo.params.shortsLen = 'knicker' } }
  if (it.slot === 'warmers') { c.warmer = 'enzian'; lo.opts.warmers = opt ?? 'armleg' }
  if (it.slot === 'socks') { c.socks = it.pattern === 'spring' ? 'meadow' : 'snow'; c.sockAccent = it.pattern === 'spring' ? 'sun' : 'enzian' }
  if (it.slot === 'overshoes') c.overshoe = 'enzian'
  if (it.slot === 'shoes' && it.id === 'shoe.vintage') c.shoes = 'leather'
  if (it.slot === 'gloves') c.gloves = it.id === 'glove.lobster' ? 'army' : 'ink'
  if (it.slot === 'helmet' || it.slot === 'helmetDeco') { c.helmet = it.id === 'helmet.hairnet' ? 'leather' : 'snow'; c.helmetAccent = it.id === 'helmet.hairnet' ? 'tan' : 'enzian' }
  if (it.slot === 'cap') { c.cap = it.colour ?? 'cream'; c.capAccent = it.pattern === 'trim' ? 'snow' : 'enzian'; lo.helmet = 'helmet.hairnet'; c.helmet = 'leather'; c.helmetAccent = 'tan' }
  if (it.slot === 'hair') { lo.helmet = 'helmet.road'; c.hair = 'brick' }
  if (it.slot === 'armband') c.armband = 'sun'
  if (it.slot === 'finish') { c.frame = 'fir'; c.frameAccent = 'sun'; if (it.finish === 'chrome' || it.finish === 'rings') { c.frame = 'brick'; c.frameAccent = 'cream' } }
  if (it.slot === 'tape') { c.barTape = it.id === 'tape.plain' ? 'ink' : { cork: 'sand', leather: 'leather', perforated: 'snow', cloth: 'cream', twotone: 'ink' }[lo.opts.tape] ?? 'tan' }
  if (it.slot === 'tyres') c.tyreWall = 'sun'
  if (it.slot === 'gsFinish') c.anodised = 'alpine'
  if (it.slot === 'bags' || it.slot === 'utility') { c.bag = it.id === 'bag.rando' ? 'sand' : 'graphite'; c.bagAccent = it.id === 'bag.rando' ? 'leather' : 'sun' }
  if (it.slot === 'bottles') { lo.params.bottles = 2; c.bottle = it.id === 'bottle.gruppetto' ? 'enzian' : 'snow'; if (it.id === 'bottle.gruppetto') c.jerseyB = 'sun' }
  if (it.slot === 'cages') lo.params.bottles = 2
  if (it.slot === 'wheels') lo.params.rimMm = 60
  if (it.slot === 'lens') lo.glasses = 'glasses.wrap'
  if (it.slot === 'plate') lo.params.number = 42
  if (it.slot === 'jersey' && it.id === 'jp.crew') lo.name = 'Crew kit'
  return lo
}
// the rule a rider reads under an item
export function unlockLabel(it, cat) {
  if (it.tier) return null
  if (it.starter) return 'In your garage from day one'
  if (it.free) return 'Free to pick'
  if (it.crewOnly) return 'Your crew designs it; members wear it free'
  if (it.unlock?.startsWith('with:')) return 'Comes with the ' + it.unlock.slice(5).split('|').map((id) => cat.items.find((x) => x.id === id)?.name ?? id).join(' or ')
  if (it.unlock?.startsWith('earned:')) { const k = it.unlock.slice(7); return cat.unlockText[k] ?? k }
  return ''
}
export const kindOf = (it) => (it.tier ? 'buy' : it.unlock?.startsWith('earned:') ? 'earn' : it.unlock?.startsWith('with:') ? 'with' : it.crewOnly ? 'crew' : 'free')
