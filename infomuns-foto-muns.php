<?php
/**
 * Plugin Name: InfoMuns — Foto a Estilo Muns
 * Description: Convierte una foto al estilo 2D Muns y permite agregar personajes basados en la historia.
 */

defined( 'ABSPATH' ) || exit;

add_action( 'admin_enqueue_scripts', function ( $hook ) {
	if ( in_array( $hook, [ 'post.php', 'post-new.php' ], true ) ) {
		wp_enqueue_media();
	}
} );

add_action( 'add_meta_boxes', function () {
	add_meta_box(
		'infomuns-foto-muns',
		'🖼️ Foto → Estilo Muns',
		'_ifm_render_foto_muns_box',
		'post',
		'side',
		'high'
	);
} );

add_action( 'wp_ajax_ifm_upload_image', function () {
	check_ajax_referer( 'ifm_upload_image', 'nonce' );

	$base64  = $_POST['imageBase64'] ?? '';
	$mime    = sanitize_text_field( $_POST['imageMime'] ?? 'image/png' );
	$post_id = intval( $_POST['postId'] ?? 0 );

	if ( ! $base64 ) wp_send_json_error( 'imageBase64 requerido' );

	$data = base64_decode( $base64 );
	if ( ! $data ) wp_send_json_error( 'base64 inválido' );

	$ext = ( $mime === 'image/jpeg' || $mime === 'image/jpg' ) ? 'jpg' : 'png';

	// tempnam crea el archivo base; añadimos extensión para un path distinto con extensión correcta
	$tmp_base = tempnam( sys_get_temp_dir(), 'ifm' );
	$tmp      = $tmp_base . '.' . $ext;
	file_put_contents( $tmp, $data );
	@unlink( $tmp_base ); // limpiamos el archivo vacío generado por tempnam

	require_once ABSPATH . 'wp-admin/includes/image.php';
	require_once ABSPATH . 'wp-admin/includes/file.php';
	require_once ABSPATH . 'wp-admin/includes/media.php';

	$file_array = [
		'name'     => 'muns-style-' . time() . '.' . $ext,
		'type'     => $mime,
		'tmp_name' => $tmp,
		'error'    => 0,
		'size'     => filesize( $tmp ),
	];

	$att_id = media_handle_sideload( $file_array, $post_id );
	@unlink( $tmp );

	if ( is_wp_error( $att_id ) ) {
		wp_send_json_error( $att_id->get_error_message() );
	}

	if ( $post_id > 0 ) {
		set_post_thumbnail( $post_id, $att_id );
	}

	$library_url = admin_url( 'upload.php?item=' . $att_id );

	wp_send_json_success( [
		'id'         => $att_id,
		'url'        => wp_get_attachment_url( $att_id ),
		'libraryUrl' => $library_url,
	] );
} );

function _ifm_render_foto_muns_box( WP_Post $post ) {
	$api_base = defined( 'INFOMUNS_API_BASE' ) ? INFOMUNS_API_BASE : 'https://infomuns-production.up.railway.app';
	$token    = defined( 'INFOMUNS_ADMIN_TOKEN' ) ? INFOMUNS_ADMIN_TOKEN : '';
	$post_id  = intval( $post->ID );
	$nonce    = wp_create_nonce( 'ifm_upload_image' );
	?>
	<style>
		#ifm-wrap { font-size: .82em; }
		#ifm-sources { display: flex; gap: 6px; margin-bottom: 8px; }
		#ifm-sources button { flex: 1; padding: 7px 4px; border: 2px dashed #c3c4c7; border-radius: 6px; background: #fff; cursor: pointer; color: #757575; font-size: .82em; transition: border-color .15s, background .15s; }
		#ifm-sources button:hover { border-color: #2271b1; background: #f0f6fc; color: #2271b1; }
		#ifm-selected { margin-bottom: 6px; padding: 5px 8px; background: #f0f6fc; border-radius: 4px; border: 1px solid #c3c4c7; color: #2271b1; font-weight: 600; display: none; word-break: break-all; }
		.ifm-cmp { display: none; gap: 6px; margin-top: 8px; color: #757575; text-align: center; }
		.ifm-cmp > div { flex: 1; }
		.ifm-cmp img { width: 100%; border-radius: 4px; border: 1px solid #dcdcde; display: block; margin-bottom: 2px; }
		#ifm-char-picker { display: none; background: #f6f7f7; border: 1px solid #c3c4c7; border-radius: 6px; padding: 8px; margin-top: 8px; }
		#ifm-char-picker label { display: block; margin-bottom: 4px; font-weight: 600; color: #1d2327; }
		#ifm-char-select { width: 100%; margin-bottom: 6px; padding: 4px; border-radius: 4px; border: 1px solid #c3c4c7; font-size: .85em; }
		#ifm-char-suggestion { font-size: .78em; color: #646970; margin-bottom: 6px; }
		#ifm-actions { display: none; flex-direction: column; gap: 5px; margin-top: 8px; }
		#ifm-status { min-height: 16px; margin: 6px 0; color: #757575; }
	</style>

	<div id="ifm-wrap">
		<div id="ifm-sources">
			<button type="button" id="ifm-btn-library">📂 Biblioteca</button>
			<button type="button" id="ifm-btn-upload">💻 Desde compu</button>
		</div>
		<input type="file" id="ifm-file" accept="image/*" style="display:none;" />

		<div id="ifm-selected"></div>

		<div class="ifm-cmp" id="ifm-cmp1">
			<div><img id="ifm-orig" src="" alt="Original" /><span>Original</span></div>
			<div><img id="ifm-result1" src="" alt="Estilo Muns" /><span>Estilo Muns ✨</span></div>
		</div>

		<!-- Picker de personaje (aparece tras convertir) -->
		<div id="ifm-char-picker">
			<label>🎭 Personaje Muns</label>
			<div id="ifm-char-suggestion"></div>
			<select id="ifm-char-select">
				<option value="mun_contento">Mun alegre</option>
				<option value="mun_triste">Mun triste</option>
				<option value="mun_enojado">Mun enojado</option>
				<option value="mun_sorprendido">Mun sorprendido</option>
				<option value="mun_conmovido">Mun conmovido</option>
				<option value="mun_divertido">Mun divertido</option>
				<option value="opaq_contento">Opaq alegre</option>
				<option value="opaq_triste">Opaq triste</option>
				<option value="opaq_enojado">Opaq enojado</option>
				<option value="opaq_sorprendido">Opaq sorprendido</option>
			</select>
			<button type="button" id="ifm-char-gen-btn" class="button button-primary" style="width:100%;">✨ Generar con este personaje</button>
		</div>

		<div class="ifm-cmp" id="ifm-cmp2">
			<div><img id="ifm-result2a" src="" alt="Estilo Muns" /><span>Estilo Muns</span></div>
			<div><img id="ifm-result2b" src="" alt="Con personaje" /><span>Con personaje 🎭</span></div>
		</div>

		<div id="ifm-actions">
			<a id="ifm-link-library" href="#" target="_blank" class="button button-small" style="text-align:center;">📂 Ver en biblioteca de medios</a>
			<button type="button" id="ifm-insert-btn" class="button button-small" style="width:100%;">📌 Insertar en el contenido</button>
		</div>

		<div id="ifm-status"></div>

		<button type="button" id="ifm-btn" class="button button-secondary" style="width:100%;margin-top:4px;" disabled>
			✨ Convertir a estilo Muns
		</button>
	</div>

	<script>
	(function () {
		const API     = <?php echo wp_json_encode( $api_base ); ?>;
		const TOKEN   = <?php echo wp_json_encode( $token ); ?>;
		const POST_ID = <?php echo $post_id; ?>;
		const NONCE   = <?php echo wp_json_encode( $nonce ); ?>;
		const AJAX    = <?php echo wp_json_encode( admin_url( 'admin-ajax.php' ) ); ?>;

		const fileIn       = document.getElementById('ifm-file');
		const btnLib       = document.getElementById('ifm-btn-library');
		const btnUp        = document.getElementById('ifm-btn-upload');
		const selected     = document.getElementById('ifm-selected');
		const btn          = document.getElementById('ifm-btn');
		const statusEl     = document.getElementById('ifm-status');
		const cmp1         = document.getElementById('ifm-cmp1');
		const cmp2         = document.getElementById('ifm-cmp2');
		const origImg      = document.getElementById('ifm-orig');
		const result1Img   = document.getElementById('ifm-result1');
		const result2aImg  = document.getElementById('ifm-result2a');
		const result2bImg  = document.getElementById('ifm-result2b');
		const actions      = document.getElementById('ifm-actions');
		const libLink      = document.getElementById('ifm-link-library');
		const insertBtn    = document.getElementById('ifm-insert-btn');
		const charPicker   = document.getElementById('ifm-char-picker');
		const charSelect   = document.getElementById('ifm-char-select');
		const charSugg     = document.getElementById('ifm-char-suggestion');
		const charGenBtn   = document.getElementById('ifm-char-gen-btn');

		let sourceFile = null;
		let sourceUrl  = null;
		let lastBase64 = null;
		let lastMime   = null;
		let lastMediaId  = null;
		let lastMediaUrl = null;

		// ── Upload desde compu / drag & drop ─────────────────────────────────
		btnUp.addEventListener('dragover',  e => { e.preventDefault(); btnUp.style.borderColor = '#2271b1'; });
		btnUp.addEventListener('dragleave', () => btnUp.style.borderColor = '');
		btnUp.addEventListener('drop', e => { e.preventDefault(); btnUp.style.borderColor = ''; pickFile(e.dataTransfer.files[0]); });
		btnUp.addEventListener('click', () => fileIn.click());
		fileIn.addEventListener('change', () => pickFile(fileIn.files[0]));

		function pickFile(f) {
			if (!f || !f.type.startsWith('image/')) { setStatus('Solo imágenes (JPG, PNG, WEBP).', 'error'); return; }
			sourceFile = f; sourceUrl = null;
			selected.textContent = '📸 ' + f.name;
			selected.style.display = 'block';
			btn.disabled = false;
			resetResults();
			setStatus('');
		}

		// ── Biblioteca de medios ──────────────────────────────────────────────
		btnLib.addEventListener('click', () => {
			if (typeof wp === 'undefined' || !wp.media) { setStatus('Picker no disponible.', 'error'); return; }
			const frame = wp.media({ title: 'Elegí la foto fuente', button: { text: 'Usar esta foto' }, multiple: false, library: { type: 'image' } });
			frame.on('select', function () {
				const att = frame.state().get('selection').first().toJSON();
				sourceUrl = att.url; sourceFile = null;
				selected.textContent = '📂 ' + (att.filename || att.title || att.url.split('/').pop());
				selected.style.display = 'block';
				btn.disabled = false;
				resetResults();
				setStatus('');
			});
			frame.open();
		});

		function resetResults() {
			cmp1.style.display = 'none';
			cmp2.style.display = 'none';
			charPicker.style.display = 'none';
			actions.style.display = 'none';
			lastBase64 = null; lastMime = null; lastMediaId = null; lastMediaUrl = null;
		}

		// ── Leer contenido del editor ─────────────────────────────────────────
		function getEditorText() {
			if (window.tinyMCE && tinyMCE.activeEditor && !tinyMCE.activeEditor.isHidden()) {
				return tinyMCE.activeEditor.getContent({ format: 'text' });
			}
			const ta = document.getElementById('content');
			return ta ? ta.value : '';
		}

		// ── Subir imagen a biblioteca WP via AJAX ─────────────────────────────
		async function uploadToWP(base64, mime) {
			const fd = new FormData();
			fd.append('action', 'ifm_upload_image');
			fd.append('nonce', NONCE);
			fd.append('imageBase64', base64);
			fd.append('imageMime', mime);
			if (POST_ID > 0) fd.append('postId', String(POST_ID));

			const wpRes  = await fetch(AJAX, { method: 'POST', body: fd, credentials: 'same-origin' });
			const wpData = await wpRes.json();
			if (!wpData.success) throw new Error(wpData.data || 'Error al subir a WordPress');
			return wpData.data; // { id, url, libraryUrl }
		}

		// ── Conversión a estilo Muns ──────────────────────────────────────────
		function setStatus(msg, type) {
			statusEl.textContent = msg;
			statusEl.style.color = type === 'ok' ? '#00a32a' : type === 'error' ? '#d63638' : '#757575';
		}

		btn.addEventListener('click', async () => {
			if (!sourceFile && !sourceUrl) return;
			btn.disabled = true;
			resetResults();
			setStatus('⏳ Convirtiendo... puede tardar 20-40 segundos.');

			try {
				let base64, mime, previewUrl;

				if (sourceFile) {
					mime = sourceFile.type;
					previewUrl = URL.createObjectURL(sourceFile);
					base64 = await toBase64(sourceFile);
				} else {
					previewUrl = sourceUrl;
					const resp = await fetch(sourceUrl);
					if (!resp.ok) throw new Error('No se pudo descargar la imagen de la biblioteca.');
					const blob = await resp.blob();
					mime = blob.type || 'image/jpeg';
					base64 = await toBase64(blob);
				}

				setStatus('⏳ Generando imagen con Gemini...');
				const geminiRes = await fetch(API + '/api/noticias/foto-muns-style', {
					method:  'POST',
					headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
					body:    JSON.stringify({ imageBase64: base64, imageMime: mime }),
				});
				const geminiData = await geminiRes.json();
				if (!geminiRes.ok) throw new Error(geminiData.detail || geminiData.error || 'Error ' + geminiRes.status);

				lastBase64 = geminiData.imageBase64;
				lastMime   = geminiData.imageMime;

				setStatus('⏳ Guardando en biblioteca de medios...');
				const wpMedia = await uploadToWP(lastBase64, lastMime);
				lastMediaId  = wpMedia.id;
				lastMediaUrl = wpMedia.url;

				// Mostrar comparación 1
				origImg.src    = previewUrl;
				result1Img.src = lastMediaUrl;
				cmp1.style.display = 'flex';

				// Asignar como imagen destacada
				if (window.wp && wp.media && wp.media.featuredImage) {
					wp.media.featuredImage.set(lastMediaId);
				}

				// Acciones base
				libLink.href = wpMedia.libraryUrl;
				insertBtn.onclick = makeInsertHandler(lastMediaUrl, lastMediaId);
				actions.style.display = 'flex';

				// Mostrar picker de personaje — pre-cargar sugerencia en background
				charSugg.textContent = '⏳ Analizando historia para sugerir personaje...';
				charPicker.style.display = 'block';
				suggestCharacter();

				const costLabel = geminiData.cost ? ` · ~$${geminiData.cost.usd.toFixed(4)} USD` : '';
				setStatus('✓ Guardada en biblioteca.' + costLabel, 'ok');

			} catch (err) {
				setStatus('✗ ' + err.message, 'error');
			} finally {
				btn.disabled = false;
			}
		});

		// ── Sugerir personaje basado en historia ──────────────────────────────
		async function suggestCharacter() {
			const story = getEditorText();
			if (!story.trim()) {
				charSugg.textContent = '💡 Sin historia en el editor — elegí un personaje manual.';
				return;
			}
			try {
				const res  = await fetch(API + '/api/noticias/foto-muns-sugerir', {
					method:  'POST',
					headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
					body:    JSON.stringify({ story }),
				});
				const data = await res.json();
				if (!res.ok || !data.character) throw new Error(data.error || 'error');
				charSelect.value = data.character;
				charSugg.textContent = '💡 Sugerido por la historia: ' + data.displayName;
			} catch {
				charSugg.textContent = '💡 No se pudo sugerir — elegí manual.';
			}
		}

		// ── Generar imagen con personaje ──────────────────────────────────────
		charGenBtn.addEventListener('click', async () => {
			if (!lastBase64) { setStatus('Primero convertí la foto al estilo Muns.', 'error'); return; }
			const charKey = charSelect.value;
			charGenBtn.disabled = true;
			setStatus('⏳ Componiendo personaje en la imagen... puede tardar 30-60 segundos.');

			try {
				const genRes = await fetch(API + '/api/noticias/foto-muns-personajes', {
					method:  'POST',
					headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
					body:    JSON.stringify({ imageBase64: lastBase64, imageMime: lastMime, character: charKey }),
				});
				const genData = await genRes.json();
				if (!genRes.ok) throw new Error(genData.detail || genData.error || 'Error ' + genRes.status);

				setStatus('⏳ Guardando imagen con personaje en biblioteca...');
				const wpMedia2 = await uploadToWP(genData.imageBase64, genData.imageMime);

				// Mostrar comparación 2
				result2aImg.src = lastMediaUrl;
				result2bImg.src = wpMedia2.url;
				cmp2.style.display = 'flex';

				// Actualizar imagen destacada con la nueva (con personaje)
				if (window.wp && wp.media && wp.media.featuredImage) {
					wp.media.featuredImage.set(wpMedia2.id);
				}

				// Actualizar acciones con la nueva imagen
				libLink.href = wpMedia2.libraryUrl;
				insertBtn.onclick = makeInsertHandler(wpMedia2.url, wpMedia2.id);

				const costLabel = genData.cost ? ` · ~$${genData.cost.usd.toFixed(4)} USD` : '';
				setStatus('✓ Imagen con personaje guardada en biblioteca.' + costLabel, 'ok');

			} catch (err) {
				setStatus('✗ ' + err.message, 'error');
			} finally {
				charGenBtn.disabled = false;
			}
		});

		// ── Helpers ───────────────────────────────────────────────────────────
		function toBase64(fileOrBlob) {
			return new Promise((res, rej) => {
				const reader = new FileReader();
				reader.onload  = e => res(e.target.result.split(',')[1]);
				reader.onerror = rej;
				reader.readAsDataURL(fileOrBlob);
			});
		}

		function makeInsertHandler(url, mediaId) {
			return () => {
				const cls = 'aligncenter size-medium wp-image-' + (mediaId || '');
				const tag = '<img src="' + url + '" class="' + cls + '" width="640" />';
				if (window.send_to_editor) { send_to_editor(tag); }
				else { navigator.clipboard.writeText(url).then(() => setStatus('URL copiada: ' + url, 'ok')); }
			};
		}
	})();
	</script>
	<?php
}
