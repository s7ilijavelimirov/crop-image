<?php

/**
 * Plugin Name: Bulk Image Cropper for WooCommerce
 * Description: Bulk crop product images with preview and selection
 * Version: 2.0
 * Author: Your Name
 */

if (!defined('ABSPATH')) {
    exit;
}

class BulkImageCropper
{

    public function __construct()
    {
        add_action('admin_menu', array($this, 'add_admin_menu'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_scripts'));
        add_action('wp_ajax_get_product_images', array($this, 'get_product_images_ajax'));
        add_action('wp_ajax_crop_selected_images', array($this, 'crop_selected_images_ajax'));
        add_action('wp_ajax_crop_single_image', array($this, 'crop_single_image_ajax'));
        add_action('wp_ajax_search_products', array($this, 'search_products_ajax'));
        register_activation_hook(__FILE__, array($this, 'activate_plugin'));
    }

    public function activate_plugin()
    {
        $upload_dir = wp_upload_dir();
        $cropped_dir = $upload_dir['basedir'] . '/cropped-images';

        if (!file_exists($cropped_dir)) {
            wp_mkdir_p($cropped_dir);
        }
    }

    public function add_admin_menu()
    {
        add_menu_page(
            'Bulk Image Cropper',
            'Bulk Cropper',
            'manage_options',
            'bulk-image-cropper',
            array($this, 'admin_page'),
            'dashicons-format-image',
            30
        );
    }

    public function enqueue_admin_scripts($hook)
    {
        if ($hook !== 'toplevel_page_bulk-image-cropper') {
            return;
        }

        wp_enqueue_script('jquery');
        wp_enqueue_script('bulk-cropper-js', plugin_dir_url(__FILE__) . 'bulk-admin.js', array('jquery'), '2.0', true);
        wp_enqueue_style('bulk-cropper-css', plugin_dir_url(__FILE__) . 'bulk-admin.css', array(), '2.0');

        wp_localize_script('bulk-cropper-js', 'ajax_object', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('bulk_cropper_nonce')
        ));
    }

    public function admin_page()
    {
?>
        <div class="wrap">
            <h1>Bulk Image Cropper - WooCommerce Products</h1>

            <div class="bulk-cropper-container">

                <!-- Search & Filter Section -->
                <div class="section">
                    <h2>Search Products</h2>
                    <div class="search-controls">
                        <input type="text" id="product-search" placeholder="Search products by name or ID..." style="width: 300px;">
                        <button id="search-products" class="button button-primary">Search</button>
                        <button id="load-all-products" class="button">Load All Products</button>
                        <span class="loading" id="search-loading" style="display: none;">Loading...</span>
                    </div>
                </div>

                <!-- Products List -->
                <div class="section">
                    <h2>Products <span id="product-count"></span></h2>
                    <div id="products-list"></div>
                </div>

                <!-- Images Grid -->
                <div class="section">
                    <h2>Product Images</h2>
                    <div class="images-controls">
                        <button id="select-all-images" class="button">Select All</button>
                        <button id="deselect-all-images" class="button">Deselect All</button>
                        <button id="crop-selected" class="button button-primary" disabled>Crop Selected Images</button>
                        <span id="selected-count">0 selected</span>
                    </div>
                    <div id="images-grid"></div>
                </div>

                <!-- Progress Section -->
                <div class="section" id="progress-section" style="display: none;">
                    <h2>Cropping Progress</h2>
                    <div class="progress-bar">
                        <div class="progress-fill" id="progress-fill"></div>
                    </div>
                    <div id="progress-text">0 / 0</div>
                    <div id="progress-log"></div>
                </div>

                <!-- Results Section -->
                <div class="section">
                    <h2>Results</h2>
                    <div id="results-container"></div>
                </div>

            </div>
        </div>
<?php
    }

    public function search_products_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $search_term = sanitize_text_field($_POST['search_term'] ?? '');
        $load_all = $_POST['load_all'] === 'true';

        $args = array(
            'post_type' => array('product', 'product_variation'),
            'post_status' => 'publish',
            'posts_per_page' => $load_all ? -1 : 50,
            'meta_query' => array(
                'relation' => 'OR',
                array(
                    'key' => '_thumbnail_id',
                    'compare' => 'EXISTS'
                ),
                array(
                    'key' => '_product_image_gallery',
                    'compare' => 'EXISTS'
                )
            )
        );

        if (!empty($search_term)) {
            if (is_numeric($search_term)) {
                $args['p'] = $search_term;
            } else {
                $args['s'] = $search_term;
            }
        }

        $products = get_posts($args);
        $products_data = array();

        foreach ($products as $product) {
            // Obični proizvod
            if ($product->post_type === 'product') {
                $product_obj = wc_get_product($product->ID);
                if (!$product_obj) continue;

                $gallery_ids = $product_obj->get_gallery_image_ids();
                $thumbnail_id = $product_obj->get_image_id();

                // Dodaj varijacije ako su varijabilni proizvod
                $variation_images = array();
                if ($product_obj->is_type('variable')) {
                    $variations = $product_obj->get_children();
                    foreach ($variations as $variation_id) {
                        $variation_obj = wc_get_product($variation_id);
                        if ($variation_obj && $variation_obj->get_image_id()) {
                            $variation_images[] = $variation_obj->get_image_id();
                        }
                    }
                }

                $all_image_ids = array_filter(array_merge(array($thumbnail_id), $gallery_ids, $variation_images));
                $image_count = count($all_image_ids);

                if ($image_count > 0) {
                    $product_type = $product_obj->is_type('variable') ? 'Variable Product' : 'Simple Product';

                    $products_data[] = array(
                        'id' => $product->ID,
                        'title' => $product->post_title . ' (' . $product_type . ')',
                        'image_count' => $image_count,
                        'thumbnail_url' => wp_get_attachment_image_url($thumbnail_id, 'thumbnail'),
                        'edit_url' => admin_url('post.php?post=' . $product->ID . '&action=edit'),
                        'type' => $product_obj->get_type()
                    );
                }
            }
        }

        wp_send_json_success(array(
            'products' => $products_data,
            'total' => count($products_data)
        ));
    }

    public function get_product_images_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $product_id = intval($_POST['product_id']);
        $product = wc_get_product($product_id);

        if (!$product) {
            wp_send_json_error('Product not found');
        }

        $gallery_ids = $product->get_gallery_image_ids();
        $thumbnail_id = $product->get_image_id();
        $all_image_ids = array_filter(array_merge(array($thumbnail_id), $gallery_ids));

        // Dodaj slike iz varijacija ako je varijabilni proizvod
        $variation_images = array();
        if ($product->is_type('variable')) {
            $variations = $product->get_children();
            foreach ($variations as $variation_id) {
                $variation_obj = wc_get_product($variation_id);
                if ($variation_obj && $variation_obj->get_image_id()) {
                    $var_image_id = $variation_obj->get_image_id();
                    if (!in_array($var_image_id, $all_image_ids)) {
                        $variation_images[$variation_id] = $var_image_id;
                        $all_image_ids[] = $var_image_id;
                    }
                }
            }
        }

        $images_data = array();

        foreach ($all_image_ids as $image_id) {
            $image_url = wp_get_attachment_image_url($image_id, 'medium');
            $full_url = wp_get_attachment_image_url($image_id, 'full');
            $image_meta = wp_get_attachment_metadata($image_id);

            if ($image_url) {
                // Provjeri da li je slika iz varijacije
                $variation_info = '';
                foreach ($variation_images as $var_id => $var_img_id) {
                    if ($var_img_id == $image_id) {
                        $variation = wc_get_product($var_id);
                        $variation_info = ' (Variation: ' . $variation->get_name() . ')';
                        break;
                    }
                }

                $badge_text = '';
                if ($image_id == $thumbnail_id) {
                    $badge_text = 'Main';
                } elseif ($variation_info) {
                    $badge_text = 'Variation';
                } else {
                    $badge_text = 'Gallery';
                }

                $images_data[] = array(
                    'id' => $image_id,
                    'url' => $image_url,
                    'full_url' => $full_url,
                    'title' => get_the_title($image_id) . $variation_info,
                    'size' => isset($image_meta['width']) ? $image_meta['width'] . 'x' . $image_meta['height'] : 'Unknown',
                    'is_thumbnail' => $image_id == $thumbnail_id,
                    'badge' => $badge_text
                );
            }
        }

        wp_send_json_success(array(
            'images' => $images_data,
            'product_title' => $product->get_name()
        ));
    }

    public function crop_single_image_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $image_id = intval($_POST['image_id']);
        $result = $this->crop_image_by_id($image_id);

        if ($result['success']) {
            wp_send_json_success($result);
        } else {
            wp_send_json_error($result);
        }
    }

    public function crop_selected_images_ajax()
    {
        check_ajax_referer('bulk_cropper_nonce', 'nonce');

        $image_ids = array_map('intval', $_POST['image_ids']);
        $results = array();
        $success_count = 0;
        $error_count = 0;

        foreach ($image_ids as $image_id) {
            $result = $this->crop_image_by_id($image_id);
            $results[] = $result;

            if ($result['success']) {
                $success_count++;
            } else {
                $error_count++;
            }
        }

        wp_send_json_success(array(
            'results' => $results,
            'summary' => array(
                'total' => count($image_ids),
                'success' => $success_count,
                'errors' => $error_count
            )
        ));
    }

    private function crop_image_by_id($image_id)
    {
        $image_path = get_attached_file($image_id);

        if (!$image_path || !file_exists($image_path)) {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Image file not found'
            );
        }

        $python_path = $this->get_python_path();
        $script_path = plugin_dir_path(__FILE__) . 'cropper.py';

        if (!file_exists($script_path)) {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Python script not found'
            );
        }

        // Kreiraj backup originalnog fajla
        $backup_path = $image_path . '.backup';
        if (!file_exists($backup_path)) {
            copy($image_path, $backup_path);
        }

        // Temp path za cropovanu sliku
        $temp_cropped = $image_path . '.temp_cropped.png';

        // Pokreni Python script
        $command = escapeshellcmd($python_path . ' ' . $script_path . ' ' . escapeshellarg($image_path) . ' ' . escapeshellarg($temp_cropped));
        exec($command . ' 2>&1', $output, $return_var);

        $log_output = implode("\n", $output);

        if ($return_var === 0 && file_exists($temp_cropped)) {
            // Zameni originalnu sliku sa cropovanom
            if (copy($temp_cropped, $image_path)) {
                unlink($temp_cropped); // Obriši temp fajl

                // Regeneriši WordPress thumbnails
                $this->regenerate_image_sizes($image_id);

                $image_meta = wp_get_attachment_metadata($image_id);

                return array(
                    'success' => true,
                    'image_id' => $image_id,
                    'message' => 'Image cropped successfully',
                    'new_size' => isset($image_meta['width']) ? $image_meta['width'] . 'x' . $image_meta['height'] : 'Unknown',
                    'log' => $log_output
                );
            } else {
                return array(
                    'success' => false,
                    'image_id' => $image_id,
                    'message' => 'Failed to replace original image',
                    'log' => $log_output
                );
            }
        } else {
            return array(
                'success' => false,
                'image_id' => $image_id,
                'message' => 'Python script failed',
                'log' => $log_output,
                'return_code' => $return_var
            );
        }
    }

    private function regenerate_image_sizes($image_id)
    {
        $image_path = get_attached_file($image_id);

        if (!$image_path) return false;

        // Regeneriši metadata
        $metadata = wp_generate_attachment_metadata($image_id, $image_path);
        wp_update_attachment_metadata($image_id, $metadata);

        return true;
    }

    private function get_python_path()
    {
        return 'python'; // Jednostavno za Windows
    }
}

new BulkImageCropper();
?>