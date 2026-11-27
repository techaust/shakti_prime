// What the order form is given on the server: the vendors to choose from and the hubs goods may be
// delivered to (godowns and factories in use). Read through the same actions the screens use.
import { listHubs } from '../../../../actions/inventory';
import { listVendors } from '../../../../actions/procurement';

export async function orderFormChoices(): Promise<{
  vendors: { id: string; name: string }[];
  hubs: { id: string; name: string }[];
}> {
  const [vendors, hubs] = await Promise.all([listVendors({ limit: 200 }), listHubs({})]);
  return {
    vendors: vendors.ok ? vendors.data.items.map((v) => ({ id: v.id, name: v.name })) : [],
    hubs: hubs.ok
      ? hubs.data.hubs
          .filter((h) => h.kind !== 'transit' && h.archivedAt === null)
          .map((h) => ({ id: h.id, name: h.name }))
      : [],
  };
}
