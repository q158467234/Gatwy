import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * moonlight-common RTSP setup parses the Sunshine address as an IP literal.
 * Hostnames pair over HTTP, then fail with "rtsp addr: invalid IP address syntax".
 */
export async function resolveMoonlightHostAddress(host: string): Promise<string> {
  const trimmed = host.trim();
  if (!trimmed) {
    throw new Error('Sunshine 主机地址为空');
  }
  if (net.isIP(trimmed)) {
    return trimmed;
  }

  try {
    const { address } = await dns.lookup(trimmed, { family: 4 });
    return address;
  } catch {
    const { address } = await dns.lookup(trimmed);
    if (!net.isIP(address)) {
      throw new Error(`无法将 Sunshine 主机 ${trimmed} 解析为 IP 地址`);
    }
    return address;
  }
}
