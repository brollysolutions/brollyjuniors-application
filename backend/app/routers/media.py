"""
Serving the bytes.

This is the one route in the application that is not guarded by a bearer token,
and it is deliberate: the things that fetch a media URL are `<video src>`, an
`<img>`, and a PDF opened in a new tab, none of which can send an Authorization
header. So the URL itself is the credential — an HMAC over the storage key, an
expiry and the audience it was minted for, checked here before a single byte is
read off the disk (app/media.py).

The entitlement question was already answered upstream: a link only exists
because a handler decided this person may have it, and it stops working
minutes later. Nothing here re-derives who may see what.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse

from .. import db
from ..deps import public_route
from ..errors import not_found
from ..media import media_signer, media_store

router = APIRouter()


@router.get("/api/v1/media/{storage_key:path}")
async def serve_media(
    storage_key: str, expires: int = 0, sig: str = "", u: str = "",
    _=Depends(public_route),
):
    # One message for a bad signature, an expired link and a key that does not
    # exist. Telling them apart would turn this into an oracle for which files
    # are real.
    if not sig or not media_signer.verify(storage_key, expires, sig, u):
        raise not_found("That link is not valid any more. Reload the page to get a fresh one.")

    async with db.anon() as c:
        asset = await c.one(
            "SELECT file_name, mime_type FROM media_asset WHERE storage_key = $1", storage_key
        )
    if asset is None:
        raise not_found("That link is not valid any more. Reload the page to get a fresh one.")

    path = media_store.open(storage_key)
    if path is None:
        # The row exists but the bytes do not — a metadata-only asset, which is
        # every asset the demo seed creates. Say so plainly rather than 404ing
        # as though the link were forged.
        raise not_found("This file has not been uploaded yet.")

    return FileResponse(
        path,
        media_type=asset["mime_type"] or "application/octet-stream",
        headers={
            # inline so a PDF opens in the tab rather than landing in Downloads;
            # the filename is still there for when someone does save it.
            "Content-Disposition": f'inline; filename="{_ascii(asset["file_name"])}"',
            # Content-addressed keys never change what they point at, so this
            # can be cached hard. private: the URL is minted per person.
            "Cache-Control": "private, max-age=86400",
        },
    )


@router.head("/api/v1/media/{storage_key:path}")
async def head_media(
    storage_key: str, expires: int = 0, sig: str = "", u: str = "",
    _=Depends(public_route),
):
    """Some players probe with HEAD before they stream."""
    if not sig or not media_signer.verify(storage_key, expires, sig, u):
        raise not_found("That link is not valid any more.")
    path = media_store.open(storage_key)
    if path is None:
        raise not_found("This file has not been uploaded yet.")
    return Response(status_code=200, headers={"Content-Length": str(path.stat().st_size)})


def _ascii(name: str) -> str:
    """A header is latin-1; a filename from a user is not. Quotes would end it early."""
    cleaned = (name or "file").replace('"', "").replace("\\", "")
    return cleaned.encode("ascii", "ignore").decode() or "file"
