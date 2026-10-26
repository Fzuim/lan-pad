import dgram from 'node:dgram'
import os from 'node:os'
import { PORT, PUBLIC_BASE_URL } from './config.js'

export type NetworkAddress = {
  iface: string
  address: string
  url: string
}

function isPrivateIPv4(address: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
}

function rankInterface(name: string): number {
  const lower = name.toLowerCase()
  if (/^(wi-?fi|wlan|ethernet|以太网|无线)/i.test(lower)) return 0
  if (/vethernet|vmware|virtualbox|tailscale|zerotier|docker|wsl/i.test(lower)) return 2
  return 1
}

export function listPrivateIPv4(): NetworkAddress[] {
  const found: NetworkAddress[] = []
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue
      if (!isPrivateIPv4(item.address)) continue
      found.push({
        iface,
        address: item.address,
        url: `http://${item.address}:${PORT}`,
      })
    }
  }
  return found.sort((a, b) => {
    const byRank = rankInterface(a.iface) - rankInterface(b.iface)
    if (byRank !== 0) return byRank
    return a.address.localeCompare(b.address)
  })
}

function defaultRouteIPv4(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    let settled = false
    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      try {
        socket.close()
      } catch {
        // already closed
      }
      resolve(value)
    }

    socket.once('error', () => finish(null))
    try {
      socket.connect(53, '223.5.5.5', () => {
        try {
          finish(socket.address().address)
        } catch {
          finish(null)
        }
      })
    } catch {
      finish(null)
    }
    setTimeout(() => finish(null), 800).unref()
  })
}

export async function getNetworkInfo(): Promise<{
  primary: string
  primaryAddress: string
  addresses: NetworkAddress[]
}> {
  const addresses = listPrivateIPv4()
  if (PUBLIC_BASE_URL) {
    return {
      primary: PUBLIC_BASE_URL,
      primaryAddress: PUBLIC_BASE_URL.replace(/^https?:\/\//, '').replace(/:\d+$/, ''),
      addresses,
    }
  }

  const routeIp = await defaultRouteIPv4()
  const preferred = addresses.find((item) => item.address === routeIp) ?? addresses[0]
  if (preferred) {
    return { primary: preferred.url, primaryAddress: preferred.address, addresses }
  }
  return {
    primary: `http://127.0.0.1:${PORT}`,
    primaryAddress: '127.0.0.1',
    addresses,
  }
}
