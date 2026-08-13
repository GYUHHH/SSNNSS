import Furniture from './Furniture'
import { ItemVisual } from './InventoryFurniture'
import { useRoomStore } from '../store'

// the default desk mug renders through the SAME visual as inventory mugs — one 머그컵 shape everywhere
export default function Cup() {
  const { furniture } = useRoomStore()
  const item = furniture.find((value) => value.id === 'cup')
  if (!item) return null
  return <Furniture id="cup"><ItemVisual item={item} /></Furniture>
}
