package io.projectgreed.apptest2;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.util.AtomicFile;
import java.io.*;

/** Only fixed application filenames are accepted; no path is provided by JavaScript. */
interface SnapshotFiles {
    boolean exists(String name) throws Exception;
    InputStream openRead(String name) throws Exception;
    void write(String name, byte[] bytes) throws Exception;
    void preserveDamaged(String name) throws Exception;

    final class Local implements SnapshotFiles {
        private final File directory;
        Local(File directory) { this.directory = directory; directory.mkdirs(); }
        public boolean exists(String name) {
            File file = new File(directory, name);
            return file.exists() || new File(file.getPath() + ".bak").exists();
        }
        public InputStream openRead(String name) throws Exception { return new AtomicFile(new File(directory, name)).openRead(); }
        public void write(String name, byte[] bytes) throws Exception {
            AtomicFile atomic = new AtomicFile(new File(directory, name));
            FileOutputStream output = null;
            try {
                output = atomic.startWrite(); output.write(bytes); output.flush(); output.getFD().sync();
                atomic.finishWrite(output); output = null;
            } catch (Exception error) { if (output != null) atomic.failWrite(output); throw error; }
        }
        public void preserveDamaged(String name) throws Exception {
            File file = new File(directory, name);
            if (!file.renameTo(new File(directory, "profile.corrupt-" + System.currentTimeMillis() + ".json")))
                throw new IOException("Cannot preserve damaged profile");
        }
    }

    /** SAF access survives restarts through the persisted tree permission. No broad storage permission. */
    final class Documents implements SnapshotFiles {
        private final ContentResolver resolver;
        private final Uri tree, directory;
        Documents(ContentResolver resolver, Uri tree) {
            this.resolver = resolver; this.tree = tree;
            directory = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        }
        private Uri find(String name) throws Exception {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor rows = resolver.query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (rows == null) throw new IOException("无法访问所选存档文件夹，请重新授权原文件夹");
                Uri match = null;
                while (rows.moveToNext()) if (name.equals(rows.getString(1))) {
                    if (match != null) throw new IOException("存档文件名重复，请先整理所选文件夹");
                    match = DocumentsContract.buildDocumentUriUsingTree(tree, rows.getString(0));
                }
                return match;
            }
        }
        public boolean exists(String name) throws Exception { return find(name) != null; }
        public InputStream openRead(String name) throws Exception {
            Uri file = find(name);
            if (file == null) throw new FileNotFoundException(name);
            InputStream input = resolver.openInputStream(file);
            if (input == null) throw new IOException("无法读取外置存档");
            return input;
        }
        public void write(String name, byte[] bytes) throws Exception {
            Uri file = find(name);
            if (file == null) file = DocumentsContract.createDocument(resolver, directory, "application/json", name);
            if (file == null) throw new IOException("无法在所选文件夹创建存档");
            ParcelFileDescriptor descriptor = resolver.openFileDescriptor(file, "rwt");
            if (descriptor == null) throw new IOException("无法写入所选存档文件夹");
            // A local document provider exposes a durable file descriptor. Reject providers
            // that cannot flush synchronously, rather than claiming that a purchase was saved.
            try (ParcelFileDescriptor.AutoCloseOutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
                output.write(bytes); output.flush(); output.getFD().sync();
            }
        }
        public void preserveDamaged(String name) throws Exception {
            Uri file = find(name);
            if (file != null && DocumentsContract.renameDocument(resolver, file,
                    "profile.corrupt-" + System.currentTimeMillis() + ".json") == null)
                throw new IOException("无法保留损坏的外置存档，请先手动备份");
        }
    }
}
