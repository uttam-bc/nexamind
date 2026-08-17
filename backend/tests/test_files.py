import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_file_upload_download_and_delete(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Upload file
    file_content = b"Hello NexaMind file storage!"
    files = {"file": ("test_doc.txt", file_content, "text/plain")}

    upload_res = await client.post(
        f"/workspaces/{workspace_id}/files/upload",
        headers=auth_headers(token),
        files=files,
    )
    assert upload_res.status_code == 201
    file_record = upload_res.json()
    file_id = file_record["id"]
    assert file_record["filename"] == "test_doc.txt"
    assert file_record["mime_type"] == "text/plain"
    assert file_record["file_size"] == len(file_content)

    # List files
    list_res = await client.get(
        f"/workspaces/{workspace_id}/files",
        headers=auth_headers(token),
    )
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1

    # Get file metadata
    meta_res = await client.get(
        f"/workspaces/{workspace_id}/files/{file_id}",
        headers=auth_headers(token),
    )
    assert meta_res.status_code == 200
    assert meta_res.json()["filename"] == "test_doc.txt"

    # Download file content
    download_res = await client.get(
        f"/workspaces/{workspace_id}/files/{file_id}/download",
        headers=auth_headers(token),
    )
    assert download_res.status_code == 200
    assert download_res.content == file_content

    # Delete file
    del_res = await client.delete(
        f"/workspaces/{workspace_id}/files/{file_id}",
        headers=auth_headers(token),
    )
    assert del_res.status_code == 204

    # Confirm metadata deletion
    meta_after = await client.get(
        f"/workspaces/{workspace_id}/files/{file_id}",
        headers=auth_headers(token),
    )
    assert meta_after.status_code == 404
